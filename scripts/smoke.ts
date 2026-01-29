import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fetch } from 'undici';
import {
  publicKeyFromPrivateKeyHex,
  signCanonical
} from '@nanopay/shared';

const relayUrl = process.env.RELAY_URL ?? 'http://localhost:3000';

const buyerPrivkey =
  process.env.BUYER_PRIVKEY ??
  '0f5479d7c940e18eca2841eab7bba6c0aa0d11b05f7e313c24e804ff234be63d1724276816a071193d3dd8de749ff4d155586e6a9f2354b3c2501378d4ef4a72';

const buyerPubkey = publicKeyFromPrivateKeyHex(buyerPrivkey);

type Offer = { offer_id: string };
type Job = {
  job_id: string;
  status: string;
  result_payload: unknown;
};

const buildAuthHeaders = (
  method: string,
  path: string,
  body: Buffer
) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const signature = signCanonical({
    method,
    path,
    timestamp,
    nonce,
    body,
    privateKeyHex: buyerPrivkey
  });

  return {
    'x-molt-pubkey': buyerPubkey,
    'x-molt-timestamp': timestamp,
    'x-molt-nonce': nonce,
    'x-molt-signature': signature
  };
};

const signedRequest = async <T>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T | null }> => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const rawBody = payload ? Buffer.from(payload) : Buffer.alloc(0);
  const headers: Record<string, string> = {
    ...buildAuthHeaders(method, path, rawBody)
  };
  if (payload) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${relayUrl}${path}`, {
    method,
    headers,
    body: payload
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : null;
  return { status: response.status, data };
};

const waitForOffer = async () => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${relayUrl}/v1/offers?tags=web_extract&limit=1`
    );
    if (response.ok) {
      const data = (await response.json()) as { offers: Offer[] };
      if (data.offers.length > 0) return data.offers[0];
    }
    await delay(1000);
  }
  return null;
};

const waitForStatus = async (jobId: string, target: string) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const response = await signedRequest<{ job: Job }>(
      'GET',
      `/v1/jobs/${jobId}`
    );
    if (response.status !== 200 || !response.data) {
      throw new Error(`Failed to fetch job ${jobId}`);
    }
    const job = response.data.job;
    if (job.status === target) return job;
    if (['failed', 'canceled', 'expired'].includes(job.status)) {
      throw new Error(`Job ended in ${job.status}`);
    }
    await delay(1000);
  }
  throw new Error(`Timeout waiting for ${target}`);
};

const main = async () => {
  const offer = await waitForOffer();
  if (!offer) {
    throw new Error('No offers found for tag web_extract');
  }

  const jobResponse = await signedRequest<{ job: Job }>('POST', '/v1/jobs', {
    offer_id: offer.offer_id,
    request_payload: { url: 'https://example.com' }
  });
  if (jobResponse.status !== 201 || !jobResponse.data) {
    throw new Error('Failed to create job');
  }

  const jobId = jobResponse.data.job.job_id;
  await waitForStatus(jobId, 'quoted');

  const acceptResponse = await signedRequest(
    'POST',
    `/v1/jobs/${jobId}/accept`,
    {}
  );
  if (acceptResponse.status !== 200) {
    throw new Error('Failed to accept job');
  }

  const paymentResponse = await signedRequest(
    'POST',
    `/v1/jobs/${jobId}/payment`,
    { payment_tx_hash: 'TEST_PAYMENT_HASH' }
  );
  if (paymentResponse.status !== 200) {
    throw new Error('Failed to submit payment hash');
  }

  const delivered = await waitForStatus(jobId, 'delivered');
  if (!delivered.result_payload) {
    throw new Error('Missing result payload');
  }

  console.log('Smoke success');
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
