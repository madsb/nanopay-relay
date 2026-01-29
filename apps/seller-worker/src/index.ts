import { WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  buildCanonicalString,
  generateKeypair,
  signDetachedHex
} from "@nanopay/shared";

type Keypair = ReturnType<typeof generateKeypair>;

type Job = {
  job_id: string;
  status: string;
  request_payload: unknown;
  payment_tx_hash?: string | null;
};

const relayUrl = process.env.RELAY_URL ?? "http://127.0.0.1:3000";
const wsUrl =
  process.env.RELAY_WS_URL ?? relayUrl.replace(/^http/, "ws") + "/ws/seller";
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? "1500");
const oneShot = process.env.SELLER_ONESHOT === "1";

const seller = generateKeypair();

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
    keypair: seller
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

const registerOffer = async () => {
  const payload = {
    title: "demo: web_extract",
    description: "Extracts content and returns markdown",
    tags: ["demo", "extract"],
    pricing_mode: "fixed",
    fixed_price_raw: "1000000",
    active: true
  };
  const { offer } = await requestJson<{ offer: { offer_id: string } }>(
    "POST",
    "/v1/offers",
    payload
  );
  return offer.offer_id;
};

const listJobs = async (params: Record<string, string>) => {
  const url = new URL("/v1/jobs", relayUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const { jobs } = await requestJson<{ jobs: Job[] }>(
    "GET",
    url.pathname + url.search
  );
  return jobs;
};

const quoteJob = async (jobId: string) => {
  const payload = {
    quote_amount_raw: "1000000",
    quote_invoice_address: `nano_demo_${jobId.slice(0, 8)}`,
    quote_expires_at: null
  };
  await requestJson("POST", `/v1/jobs/${jobId}/quote`, payload);
};

const lockJob = async (jobId: string) => {
  await requestJson("POST", `/v1/jobs/${jobId}/lock`, {});
};

const deliverJob = async (jobId: string, result: unknown) => {
  const payload = {
    result_payload: result,
    error: null
  };
  await requestJson("POST", `/v1/jobs/${jobId}/deliver`, payload);
};

const executeDummyTask = async (job: Job) => {
  await delay(200);
  return {
    ok: true,
    echoed: job.request_payload
  };
};

const runWorker = async () => {
  const offerId = await registerOffer();
  process.stdout.write(`Seller online with offer ${offerId}\n`);

  const quotedJobs = new Set<string>();
  const deliveredJobs = new Set<string>();

  let pollRequested = true;
  let polling = false;

  const pollOnce = async () => {
    const requested = await listJobs({
      status: "requested",
      offer_id: offerId,
      limit: "25"
    });
    for (const job of requested) {
      if (quotedJobs.has(job.job_id)) continue;
      await quoteJob(job.job_id);
      quotedJobs.add(job.job_id);
      process.stdout.write(`Quoted job ${job.job_id}\n`);
    }

    const accepted = await listJobs({
      status: "accepted",
      offer_id: offerId,
      limit: "25"
    });
    for (const job of accepted) {
      if (deliveredJobs.has(job.job_id)) continue;
      if (!job.payment_tx_hash) continue;
      await lockJob(job.job_id);
      const result = await executeDummyTask(job);
      await deliverJob(job.job_id, result);
      deliveredJobs.add(job.job_id);
      process.stdout.write(`Delivered job ${job.job_id}\n`);
      if (oneShot) {
        process.exit(0);
      }
    }
  };

  const pollLoop = async () => {
    if (polling) return;
    polling = true;
    try {
      while (pollRequested) {
        pollRequested = false;
        await pollOnce();
      }
    } finally {
      polling = false;
    }
  };

  const schedulePoll = () => {
    pollRequested = true;
    void pollLoop();
  };

  const wsReady = new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      // no-op; wait for auth challenge
    });
    ws.on("message", (data) => {
      let message: { type?: string; nonce?: string; seller_pubkey?: string } | null =
        null;
      try {
        const text =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Buffer.from(data as ArrayBuffer).toString("utf8");
        message = JSON.parse(text);
      } catch {
        ws.close();
        reject(new Error("Invalid WS message"));
        return;
      }

      if (!message || typeof message.type !== "string") {
        ws.close();
        reject(new Error("Missing WS message type"));
        return;
      }

      if (message.type === "auth.challenge") {
        const nonce = message.nonce ?? "";
        const signature = signDetachedHex(nonce, seller.secretKey);
        ws.send(
          JSON.stringify({
            type: "auth.response",
            pubkey: seller.publicKey,
            signature
          })
        );
        return;
      }

      if (message.type === "auth.ok") {
        resolve();
        return;
      }

      if (message.type === "hint.new_job") {
        schedulePoll();
        return;
      }

      if (message.type === "error") {
        ws.close();
        reject(new Error("WS auth error"));
        return;
      }
    });

    ws.on("error", (err) => {
      reject(err);
    });
  });

  await wsReady;
  process.stdout.write("Seller WS authenticated\n");

  schedulePoll();

  setInterval(schedulePoll, pollIntervalMs);
};

runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
