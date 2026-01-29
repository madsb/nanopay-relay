import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { createApp } from "../src/app.js";
import {
  buildCanonicalString,
  signDetachedHex,
  generateKeypair
} from "@nanopay/shared";
import { randomBytes } from "node:crypto";

const defaultDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/nanopay_relay?sslmode=disable";

type Keypair = ReturnType<typeof generateKeypair>;

const makeAuthHeaders = ({
  method,
  url,
  body,
  keypair,
  nonce
}: {
  method: string;
  url: string;
  body?: string;
  keypair: Keypair;
  nonce?: string;
}) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceValue = nonce ?? randomBytes(16).toString("hex");
  const bodyValue = body ?? "";
  const canonical = buildCanonicalString({
    method,
    pathWithQuery: url,
    timestamp,
    nonce: nonceValue,
    body: Buffer.from(bodyValue, "utf8")
  });
  const signature = signDetachedHex(canonical, keypair.secretKey);
  return {
    "content-type": "application/json",
    "x-molt-pubkey": keypair.publicKey,
    "x-molt-timestamp": timestamp,
    "x-molt-nonce": nonceValue,
    "x-molt-signature": signature
  };
};

describe("gate 2 auth + offers + jobs", () => {
  const seller = generateKeypair();
  const buyer = generateKeypair();
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    app = await createApp({ databaseUrl: defaultDatabaseUrl });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE jobs, offers, auth_nonces RESTART IDENTITY CASCADE`.execute(
      app.db
    );
  });

  it("rejects invalid signatures", async () => {
    const payload = JSON.stringify({
      title: "Test Offer",
      description: "Desc",
      tags: [],
      pricing_mode: "fixed",
      fixed_price_raw: "1000",
      active: true
    });

    const headers = makeAuthHeaders({
      method: "POST",
      url: "/v1/offers",
      body: payload,
      keypair: seller
    });

    headers["x-molt-signature"] = "00".repeat(64);

    const res = await app.inject({
      method: "POST",
      url: "/v1/offers",
      payload,
      headers
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("auth.invalid_signature");
  });

  it("rejects nonce replay", async () => {
    const payload = JSON.stringify({
      title: "Replay Offer",
      description: "Desc",
      tags: [],
      pricing_mode: "fixed",
      fixed_price_raw: "1000",
      active: true
    });

    const nonce = randomBytes(16).toString("hex");
    const headers = makeAuthHeaders({
      method: "POST",
      url: "/v1/offers",
      body: payload,
      keypair: seller,
      nonce
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/offers",
      payload,
      headers
    });

    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/v1/offers",
      payload,
      headers
    });

    expect(second.statusCode).toBe(401);
    const body = JSON.parse(second.body);
    expect(body.error.code).toBe("auth.nonce_replay");
  });

  it("runs a full job lifecycle", async () => {
    const offerPayload = JSON.stringify({
      title: "Extract",
      description: "Fetch URL",
      tags: ["web"],
      pricing_mode: "fixed",
      fixed_price_raw: "1000000",
      active: true
    });

    const offerHeaders = makeAuthHeaders({
      method: "POST",
      url: "/v1/offers",
      body: offerPayload,
      keypair: seller
    });

    const offerRes = await app.inject({
      method: "POST",
      url: "/v1/offers",
      payload: offerPayload,
      headers: offerHeaders
    });

    expect(offerRes.statusCode).toBe(201);
    const offer = JSON.parse(offerRes.body).offer;

    const jobPayload = JSON.stringify({
      offer_id: offer.offer_id,
      request_payload: { url: "https://example.com" }
    });

    const jobHeaders = makeAuthHeaders({
      method: "POST",
      url: "/v1/jobs",
      body: jobPayload,
      keypair: buyer
    });

    const jobRes = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: jobPayload,
      headers: jobHeaders
    });

    expect(jobRes.statusCode).toBe(201);
    const job = JSON.parse(jobRes.body).job;

    const quotePayload = JSON.stringify({
      quote_amount_raw: "2000000",
      quote_invoice_address: "nano_3testaddress",
      quote_expires_at: null
    });

    const quoteHeaders = makeAuthHeaders({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/quote`,
      body: quotePayload,
      keypair: seller
    });

    const quoteRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/quote`,
      payload: quotePayload,
      headers: quoteHeaders
    });

    expect(quoteRes.statusCode).toBe(200);
    const quoted = JSON.parse(quoteRes.body).job;
    expect(quoted.status).toBe("quoted");

    const acceptPayload = JSON.stringify({});
    const acceptHeaders = makeAuthHeaders({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/accept`,
      body: acceptPayload,
      keypair: buyer
    });

    const acceptRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/accept`,
      payload: acceptPayload,
      headers: acceptHeaders
    });

    expect(acceptRes.statusCode).toBe(200);
    const accepted = JSON.parse(acceptRes.body).job;
    expect(accepted.status).toBe("accepted");

    const paymentPayload = JSON.stringify({
      payment_tx_hash: "ABC123"
    });

    const paymentHeaders = makeAuthHeaders({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/payment`,
      body: paymentPayload,
      keypair: buyer
    });

    const paymentRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/payment`,
      payload: paymentPayload,
      headers: paymentHeaders
    });

    expect(paymentRes.statusCode).toBe(200);
    const paid = JSON.parse(paymentRes.body).job;
    expect(paid.payment_tx_hash).toBe("ABC123");

    const lockPayload = JSON.stringify({});
    const lockHeaders = makeAuthHeaders({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/lock`,
      body: lockPayload,
      keypair: seller
    });

    const lockRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/lock`,
      payload: lockPayload,
      headers: lockHeaders
    });

    expect(lockRes.statusCode).toBe(200);
    const locked = JSON.parse(lockRes.body).job;
    expect(locked.status).toBe("running");

    const deliverPayload = JSON.stringify({
      result_payload: { ok: true },
      error: null
    });

    const deliverHeaders = makeAuthHeaders({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/deliver`,
      body: deliverPayload,
      keypair: seller
    });

    const deliverRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.job_id}/deliver`,
      payload: deliverPayload,
      headers: deliverHeaders
    });

    expect(deliverRes.statusCode).toBe(200);
    const delivered = JSON.parse(deliverRes.body).job;
    expect(delivered.status).toBe("delivered");

    const getHeaders = makeAuthHeaders({
      method: "GET",
      url: `/v1/jobs/${job.job_id}`,
      keypair: buyer
    });

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/jobs/${job.job_id}`,
      headers: getHeaders
    });

    expect(getRes.statusCode).toBe(200);
    const fetched = JSON.parse(getRes.body).job;
    expect(fetched.status).toBe("delivered");
  });
});
