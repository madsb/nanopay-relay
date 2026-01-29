import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  buildCanonicalString,
  generateKeypair,
  signDetachedHex
} from "@nanopay/shared";

type Keypair = ReturnType<typeof generateKeypair>;

const relayUrl = process.env.RELAY_URL ?? "http://127.0.0.1:3000";
const buyer = generateKeypair();

const makeAuthHeaders = ({
  method,
  url,
  body,
  keypair
}: {
  method: string;
  url: string;
  body?: string;
  keypair: Keypair;
}) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");
  const bodyValue = body ?? "";
  const canonical = buildCanonicalString({
    method,
    pathWithQuery: url,
    timestamp,
    nonce,
    body: Buffer.from(bodyValue, "utf8")
  });
  const signature = signDetachedHex(canonical, keypair.secretKey);
  return {
    "content-type": "application/json",
    "x-molt-pubkey": keypair.publicKey,
    "x-molt-timestamp": timestamp,
    "x-molt-nonce": nonce,
    "x-molt-signature": signature
  };
};

const requestJson = async <T>(
  method: string,
  pathWithQuery: string,
  body?: unknown
): Promise<T> => {
  const url = new URL(pathWithQuery, relayUrl);
  const payload = body ? JSON.stringify(body) : "";
  const headers = makeAuthHeaders({
    method,
    url: url.pathname + url.search,
    body: payload,
    keypair: buyer
  });

  const res = await fetch(url, {
    method,
    headers,
    body: payload ? payload : undefined
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
};

const waitForOffer = async (attempts = 40) => {
  for (let i = 0; i < attempts; i += 1) {
    const url = new URL("/v1/offers", relayUrl);
    url.searchParams.set("online_only", "true");
    url.searchParams.set("limit", "1");
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as { offers: Array<{ offer_id: string }> };
      if (data.offers.length > 0) return data.offers[0];
    }
    await delay(1000);
  }
  throw new Error("Timed out waiting for seller offer");
};

const waitForJobStatus = async (jobId: string, status: string, attempts = 60) => {
  for (let i = 0; i < attempts; i += 1) {
    const { job } = await requestJson<{ job: { status: string } }>(
      "GET",
      `/v1/jobs/${jobId}`
    );
    if (job.status === status) return;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
};

const main = async () => {
  const offer = await waitForOffer();

  const jobPayload = {
    offer_id: offer.offer_id,
    request_payload: { url: "https://example.com" }
  };

  const { job } = await requestJson<{ job: { job_id: string } }>(
    "POST",
    "/v1/jobs",
    jobPayload
  );

  await waitForJobStatus(job.job_id, "quoted");

  await requestJson("POST", `/v1/jobs/${job.job_id}/accept`, {});

  await requestJson("POST", `/v1/jobs/${job.job_id}/payment`, {
    payment_tx_hash: "MOCK_HASH_123"
  });

  await waitForJobStatus(job.job_id, "delivered");

  process.stdout.write("Gate 3 smoke flow completed\n");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
