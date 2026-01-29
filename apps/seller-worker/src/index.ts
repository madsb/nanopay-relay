import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fetch } from 'undici';
import WebSocket from 'ws';
import {
  publicKeyFromPrivateKeyHex,
  signCanonical,
  signNonce
} from '@nanopay/shared';

type Job = {
  job_id: string;
  status: string;
  request_payload: unknown;
  quote_amount_raw: string | null;
  quote_invoice_address: string | null;
  quote_expires_at: string | null;
  payment_tx_hash: string | null;
};

const relayUrl = process.env.RELAY_URL ?? 'http://localhost:3000';
const sellerPrivkey = process.env.SELLER_PRIVKEY;
const nanoSeed = process.env.NANO_SEED ?? 'stub';
const nanoRpcUrl = process.env.NANO_RPC_URL ?? 'stub';

if (!sellerPrivkey) {
  console.error('SELLER_PRIVKEY is required');
  process.exit(1);
}

const sellerPubkey = publicKeyFromPrivateKeyHex(sellerPrivkey);

const wsUrl = relayUrl.replace(/^http/i, 'ws') + '/ws/seller';

const buildAuthHeaders = (method: string, path: string, body: Buffer) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const signature = signCanonical({
    method,
    path,
    timestamp,
    nonce,
    body,
    privateKeyHex: sellerPrivkey
  });

  return {
    'x-molt-pubkey': sellerPubkey,
    'x-molt-timestamp': timestamp,
    'x-molt-nonce': nonce,
    'x-molt-signature': signature
  };
};

const apiRequest = async <T>(
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

  try {
    const response = await fetch(`${relayUrl}${path}`, {
      method,
      headers,
      body: payload
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as T) : null;
    return { status: response.status, data };
  } catch (error) {
    console.error('Request failed', method, path, error);
    return { status: 0, data: null };
  }
};

const registerOffer = async () => {
  const offerPayload = {
    title: 'Web Extract',
    description: 'Extract markdown from a URL.',
    tags: ['web_extract'],
    pricing_mode: 'quote',
    fixed_price_raw: null,
    active: true
  };
  const response = await apiRequest<{ offer: { offer_id: string } }>(
    'POST',
    '/v1/offers',
    offerPayload
  );
  if (response.status !== 201) {
    console.error('Failed to register offer', response.status, response.data);
    return null;
  }
  return response.data?.offer.offer_id ?? null;
};

const listJobs = async () => {
  const path =
    '/v1/jobs?role=seller&status=requested,accepted&limit=50&offset=0';
  return apiRequest<{ jobs: Job[] }>('GET', path);
};

const createQuote = async (jobId: string) => {
  const payload = {
    quote_amount_raw: '1000',
    quote_invoice_address: `nano_1${randomBytes(16).toString('hex')}`,
    quote_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  };
  return apiRequest('POST', `/v1/jobs/${jobId}/quote`, payload);
};

const lockJob = async (jobId: string) =>
  apiRequest('POST', `/v1/jobs/${jobId}/lock`, {});

const deliverJob = async (jobId: string, result: Record<string, unknown>) =>
  apiRequest('POST', `/v1/jobs/${jobId}/deliver`, {
    result_payload: result,
    error: null
  });

const verifyPayment = (hash: string | null) =>
  Boolean(hash && hash.trim().length > 0);

const executeJob = (payload: unknown) => {
  const url =
    typeof payload === 'object' &&
    payload !== null &&
    'url' in payload &&
    typeof (payload as { url: unknown }).url === 'string'
      ? (payload as { url: string }).url
      : 'unknown';
  return {
    markdown: `# Web Extract\n\nSource: ${url}\n\n(Stubbed content)`
  };
};

const quotedJobs = new Set<string>();
const deliveredJobs = new Set<string>();
let polling = false;

const pollOnce = async () => {
  if (polling) return;
  polling = true;
  try {
    const response = await listJobs();
    if (response.status !== 200 || !response.data) {
      console.error('Failed to list jobs', response.status, response.data);
      return;
    }
    for (const job of response.data.jobs) {
      if (job.status === 'requested' && !quotedJobs.has(job.job_id)) {
        const quoteRes = await createQuote(job.job_id);
        if (quoteRes.status === 200) {
          quotedJobs.add(job.job_id);
        } else if (quoteRes.status === 409) {
          quotedJobs.add(job.job_id);
        } else {
          console.error('Quote failed', quoteRes.status, quoteRes.data);
        }
      }

      if (
        job.status === 'accepted' &&
        verifyPayment(job.payment_tx_hash) &&
        !deliveredJobs.has(job.job_id)
      ) {
        const lockRes = await lockJob(job.job_id);
        if (lockRes.status !== 200) {
          if (lockRes.status !== 409) {
            console.error('Lock failed', lockRes.status, lockRes.data);
          }
          continue;
        }
        const result = executeJob(job.request_payload);
        const deliverRes = await deliverJob(job.job_id, result);
        if (deliverRes.status === 200) {
          deliveredJobs.add(job.job_id);
        } else {
          console.error('Delivery failed', deliverRes.status, deliverRes.data);
        }
      }
    }
  } catch (error) {
    console.error('Polling error', error);
  } finally {
    polling = false;
  }
};

let pollTimer: NodeJS.Timeout | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;

const startPolling = () => {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void pollOnce();
  }, 2000);
  void pollOnce();
};

const connectWebSocket = () => {
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('WS connected');
  });

  ws.on('message', (data) => {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      console.error('Invalid WS message');
      return;
    }

    if (message.type === 'auth.challenge') {
      const nonce = message.nonce;
      if (typeof nonce !== 'string') {
        console.error('Invalid WS nonce');
        return;
      }
      const signature = signNonce(nonce, sellerPrivkey);
      ws.send(
        JSON.stringify({
          type: 'auth.response',
          pubkey: sellerPubkey,
          signature
        })
      );
      return;
    }

    if (message.type === 'auth.ok') {
      console.log('WS authenticated');
      return;
    }

    if (message.type === 'hint.new_job') {
      void pollOnce();
      return;
    }

    if (message.type === 'error') {
      console.error('WS error', message);
      return;
    }
  });

  ws.on('close', () => {
    console.log('WS disconnected, reconnecting...');
    if (!wsReconnectTimer) {
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket();
      }, 1000);
    }
  });

  ws.on('error', (error) => {
    console.error('WS error', error);
    ws.close();
    if (!wsReconnectTimer) {
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket();
      }, 1000);
    }
  });
};

const registerOfferWithRetry = async () => {
  while (true) {
    const offerId = await registerOffer();
    if (offerId) {
      console.log(`Registered offer ${offerId}`);
      return;
    }
    await delay(1000);
  }
};

const main = async () => {
  void nanoSeed;
  void nanoRpcUrl;
  void registerOfferWithRetry();

  connectWebSocket();
  startPolling();
};

void main();
