import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fetch } from 'undici';
import WebSocket from 'ws';
import {
  publicKeyFromPrivateKeyHex,
  signCanonical,
  signNonce
} from '@nanopay/shared';
import { NanoRpcClient } from './nano-rpc.js';
import { PaymentVerifier } from './payment-verifier.js';
import type { Job } from './types.js';
import { NanoWallet } from './wallet.js';

const relayUrl = process.env.RELAY_URL ?? 'http://localhost:3000';
const sellerPrivkey = process.env.SELLER_PRIVKEY;
const nanoSeed = process.env.NANO_SEED;
const nanoRpcUrl = process.env.NANO_RPC_URL;
const walletStatePath = process.env.NANO_WALLET_STATE_PATH ?? './data/wallet-state.json';

const parseEnvInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nanoAccountIndexStart = parseEnvInt(
  process.env.NANO_ACCOUNT_INDEX_START,
  0
);
const nanoMinConfirmations = parseEnvInt(
  process.env.NANO_MIN_CONFIRMATIONS,
  1
);
const pollIntervalMs = parseEnvInt(process.env.POLL_INTERVAL_MS, 2000);
const pollJitterMs = parseEnvInt(process.env.POLL_JITTER_MS, 250);
const lockRenewIntervalMs = parseEnvInt(
  process.env.LOCK_RENEW_INTERVAL_MS,
  120000
);
const wsBackoffBaseMs = parseEnvInt(process.env.WS_BACKOFF_BASE_MS, 500);
const wsBackoffMaxMs = parseEnvInt(process.env.WS_BACKOFF_MAX_MS, 30000);
const jobPageSize = 50;

if (!sellerPrivkey) {
  console.error('SELLER_PRIVKEY is required');
  process.exit(1);
}
if (!nanoSeed) {
  console.error('NANO_SEED is required');
  process.exit(1);
}
if (!nanoRpcUrl) {
  console.error('NANO_RPC_URL is required');
  process.exit(1);
}

const sellerPubkey = publicKeyFromPrivateKeyHex(sellerPrivkey);

const wsUrl = relayUrl.replace(/^http/i, 'ws') + '/ws/seller';

let wallet: NanoWallet | null = null;
let paymentVerifier: PaymentVerifier | null = null;

const getWallet = () => {
  if (!wallet) {
    throw new Error('Wallet not initialized');
  }
  return wallet;
};

const getPaymentVerifier = () => {
  if (!paymentVerifier) {
    throw new Error('Payment verifier not initialized');
  }
  return paymentVerifier;
};

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

type JobListResponse = {
  jobs: Job[];
  limit: number;
  offset: number;
  total: number;
};

const listJobs = async (options: {
  updatedAfter?: string | null;
  statuses?: string;
  limit?: number;
  offset?: number;
}) => {
  const params = new URLSearchParams({
    role: 'seller',
    status: options.statuses ?? 'requested,accepted,running',
    limit: String(options.limit ?? jobPageSize),
    offset: String(options.offset ?? 0)
  });
  if (options.updatedAfter) {
    params.set('updated_after', options.updatedAfter);
  }
  const path = `/v1/jobs?${params.toString()}`;
  return apiRequest<JobListResponse>('GET', path);
};

const createQuote = async (jobId: string) => {
  const invoice = await getWallet().getOrCreateInvoice(jobId);
  const payload = {
    quote_amount_raw: '1000',
    quote_invoice_address: invoice.address,
    quote_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  };
  return apiRequest('POST', `/v1/jobs/${jobId}/quote`, payload);
};

const lockJob = async (jobId: string) =>
  apiRequest<{ job: Job }>('POST', `/v1/jobs/${jobId}/lock`, {});

type DeliveryPayload = {
  result_payload: unknown | null;
  error: unknown | null;
};

const deliverJob = async (jobId: string, delivery: DeliveryPayload) =>
  apiRequest<{ job: Job }>('POST', `/v1/jobs/${jobId}/deliver`, delivery);

const verifyPayment = async (job: Job) => {
  const verifier = getPaymentVerifier();
  const result = await verifier.verify(job);
  if (!result.verified) {
    if (
      result.reason !== 'payment.not_found' &&
      result.reason !== 'payment.unconfirmed'
    ) {
      console.warn(
        'Payment verification failed',
        job.job_id,
        result.reason,
        result.details
      );
    }
    return false;
  }
  return true;
};

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

const trackedJobs = new Map<string, Job>();
const inFlightJobs = new Set<string>();
const pendingDeliveries = new Map<string, DeliveryPayload>();
const lockHeartbeats = new Map<string, NodeJS.Timeout>();
const lockLostJobs = new Set<string>();
let polling = false;
let lastUpdatedAt: string | null = null;
let initialSyncDone = false;
let wsReconnectAttempts = 0;

const isTrackedStatus = (status: string) =>
  status === 'requested' || status === 'accepted' || status === 'running';

const maxTimestamp = (current: string | null, candidate: string | null) => {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentTime = new Date(current).getTime();
  const candidateTime = new Date(candidate).getTime();
  if (!Number.isFinite(candidateTime)) return current;
  if (!Number.isFinite(currentTime)) return candidate;
  return candidateTime > currentTime ? candidate : current;
};

const stopLockHeartbeat = (jobId: string) => {
  const timer = lockHeartbeats.get(jobId);
  if (!timer) return;
  clearInterval(timer);
  lockHeartbeats.delete(jobId);
};

const clearJobState = (jobId: string) => {
  trackedJobs.delete(jobId);
  inFlightJobs.delete(jobId);
  pendingDeliveries.delete(jobId);
  lockLostJobs.delete(jobId);
  stopLockHeartbeat(jobId);
};

const updateTrackedJob = (job: Job) => {
  if (isTrackedStatus(job.status)) {
    trackedJobs.set(job.job_id, job);
  } else {
    clearJobState(job.job_id);
  }
};

const renewLock = async (jobId: string) => {
  const response = await lockJob(jobId);
  if (response.status === 200) {
    if (response.data?.job) {
      updateTrackedJob(response.data.job);
    }
    return true;
  }
  if (response.status === 409) {
    console.warn('Lock lost', jobId);
    lockLostJobs.add(jobId);
    stopLockHeartbeat(jobId);
    return false;
  }
  console.warn('Lock renewal failed', jobId, response.status, response.data);
  return false;
};

const startLockHeartbeat = (jobId: string) => {
  if (lockHeartbeats.has(jobId)) return;
  lockLostJobs.delete(jobId);
  const timer = setInterval(() => {
    void renewLock(jobId);
  }, lockRenewIntervalMs);
  lockHeartbeats.set(jobId, timer);
};

const cursorSkewMs = parseEnvInt(process.env.POLL_CURSOR_SKEW_MS, 200);

const getCursorTimestamp = () => {
  if (!lastUpdatedAt) return null;
  const parsed = new Date(lastUpdatedAt).getTime();
  if (!Number.isFinite(parsed)) return lastUpdatedAt;
  const skewed = Math.max(0, parsed - cursorSkewMs);
  return new Date(skewed).toISOString();
};

const syncTrackedJobs = async () => {
  const cursor = '1970-01-01T00:00:00.000Z';
  let offset = 0;
  let maxUpdated: string | null = lastUpdatedAt;
  while (true) {
    const response = await listJobs({
      updatedAfter: cursor,
      offset,
      limit: jobPageSize
    });
    if (response.status !== 200 || !response.data) {
      console.error('Failed to sync jobs', response.status, response.data);
      return false;
    }
    for (const job of response.data.jobs) {
      updateTrackedJob(job);
      maxUpdated = maxTimestamp(maxUpdated, job.updated_at);
    }
    const pageSize = response.data.jobs.length;
    if (pageSize < response.data.limit) break;
    offset += pageSize;
    if (offset >= response.data.total) break;
  }
  lastUpdatedAt = maxUpdated;
  initialSyncDone = true;
  return true;
};

const fetchUpdates = async () => {
  const cursor =
    getCursorTimestamp() ??
    (initialSyncDone ? null : '1970-01-01T00:00:00.000Z');
  let offset = 0;
  let maxUpdated: string | null = lastUpdatedAt;
  while (true) {
    const response = await listJobs({
      updatedAfter: cursor ?? undefined,
      offset,
      limit: jobPageSize
    });
    if (response.status !== 200 || !response.data) {
      console.error('Failed to list jobs', response.status, response.data);
      return false;
    }
    if (response.data.jobs.length === 0) break;
    for (const job of response.data.jobs) {
      updateTrackedJob(job);
      maxUpdated = maxTimestamp(maxUpdated, job.updated_at);
    }
    const pageSize = response.data.jobs.length;
    if (pageSize < response.data.limit) break;
    offset += pageSize;
    if (offset >= response.data.total) break;
  }
  if (maxUpdated) {
    lastUpdatedAt = maxUpdated;
  }
  return true;
};

const getOrCreateDelivery = async (job: Job): Promise<DeliveryPayload> => {
  const existing = pendingDeliveries.get(job.job_id);
  if (existing) return existing;

  let delivery: DeliveryPayload;
  try {
    const result = await Promise.resolve(executeJob(job.request_payload));
    if (result === undefined) {
      delivery = {
        result_payload: null,
        error: { message: 'Job execution returned no result' }
      };
    } else {
      delivery = { result_payload: result, error: null };
    }
  } catch (error) {
    delivery = {
      result_payload: null,
      error: { message: String(error) }
    };
  }
  pendingDeliveries.set(job.job_id, delivery);
  return delivery;
};

const deliverWithLock = async (job: Job) => {
  const jobId = job.job_id;
  if (lockLostJobs.has(jobId)) {
    console.warn('Skipping delivery, lock lost', jobId);
    return;
  }
  const delivery = await getOrCreateDelivery(job);
  if (lockLostJobs.has(jobId)) {
    console.warn('Skipping delivery after lock loss', jobId);
    return;
  }
  const deliverRes = await deliverJob(jobId, delivery);
  if (deliverRes.status === 200 && deliverRes.data?.job) {
    pendingDeliveries.delete(jobId);
    updateTrackedJob(deliverRes.data.job);
    return;
  }
  if (deliverRes.status === 409) {
    console.warn('Delivery rejected', jobId, deliverRes.data);
    return;
  }
  console.error('Delivery failed', jobId, deliverRes.status, deliverRes.data);
};

const runJobWithLock = async (job: Job) => {
  const jobId = job.job_id;
  if (lockLostJobs.has(jobId)) return;
  startLockHeartbeat(jobId);
  try {
    await deliverWithLock(job);
  } finally {
    stopLockHeartbeat(jobId);
  }
};

const withJobGuard = async (jobId: string, action: () => Promise<void>) => {
  if (inFlightJobs.has(jobId)) return;
  inFlightJobs.add(jobId);
  try {
    await action();
  } finally {
    inFlightJobs.delete(jobId);
  }
};

const handleRequestedJob = async (job: Job) =>
  withJobGuard(job.job_id, async () => {
    const quoteRes = await createQuote(job.job_id);
    if (quoteRes.status === 200 || quoteRes.status === 409) {
      clearJobState(job.job_id);
      return;
    }
    console.error('Quote failed', job.job_id, quoteRes.status, quoteRes.data);
  });

const handleAcceptedJob = async (job: Job) =>
  withJobGuard(job.job_id, async () => {
    const verified = await verifyPayment(job);
    if (!verified) return;
    const lockRes = await lockJob(job.job_id);
    if (lockRes.status !== 200 || !lockRes.data?.job) {
      if (lockRes.status !== 409) {
        console.error('Lock failed', job.job_id, lockRes.status, lockRes.data);
      }
      return;
    }
    const lockedJob = lockRes.data.job;
    updateTrackedJob(lockedJob);
    await runJobWithLock(lockedJob);
  });

const handleRunningJob = async (job: Job) =>
  withJobGuard(job.job_id, async () => {
    if (job.lock_owner && job.lock_owner !== sellerPubkey) {
      return;
    }
    const lockRes = await lockJob(job.job_id);
    if (lockRes.status !== 200 || !lockRes.data?.job) {
      if (lockRes.status !== 409) {
        console.error('Lock renewal failed', job.job_id, lockRes.status, lockRes.data);
      }
      return;
    }
    const lockedJob = lockRes.data.job;
    updateTrackedJob(lockedJob);
    await runJobWithLock(lockedJob);
  });

const processTrackedJobs = async () => {
  const jobs = Array.from(trackedJobs.values());
  for (const job of jobs) {
    if (job.status === 'requested') {
      await handleRequestedJob(job);
      continue;
    }
    if (job.status === 'accepted') {
      await handleAcceptedJob(job);
      continue;
    }
    if (job.status === 'running') {
      await handleRunningJob(job);
      continue;
    }
    clearJobState(job.job_id);
  }
};

const pollOnce = async () => {
  if (polling) return;
  polling = true;
  try {
    if (!initialSyncDone) {
      await syncTrackedJobs();
    }
    await fetchUpdates();
    await processTrackedJobs();
  } catch (error) {
    console.error('Polling error', error);
  } finally {
    polling = false;
  }
};

let pollTimer: NodeJS.Timeout | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;

const scheduleNextPoll = () => {
  if (pollTimer) return;
  const jitter = pollJitterMs > 0 ? Math.floor(Math.random() * pollJitterMs) : 0;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollOnce().finally(() => {
      scheduleNextPoll();
    });
  }, pollIntervalMs + jitter);
};

const startPolling = () => {
  if (pollTimer) return;
  scheduleNextPoll();
  void pollOnce();
};

const resetWsBackoff = () => {
  wsReconnectAttempts = 0;
};

const scheduleWsReconnect = (reason: string) => {
  if (wsReconnectTimer) return;
  const attempt = Math.min(wsReconnectAttempts, 10);
  const maxDelay = Math.min(wsBackoffMaxMs, wsBackoffBaseMs * 2 ** attempt);
  const delayMs = Math.floor(Math.random() * maxDelay);
  wsReconnectAttempts += 1;
  console.log(`WS reconnecting in ${delayMs}ms (${reason})`);
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, delayMs);
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
      resetWsBackoff();
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
    scheduleWsReconnect('close');
  });

  ws.on('error', (error) => {
    console.error('WS error', error);
    ws.close();
    scheduleWsReconnect('error');
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
  try {
    wallet = await NanoWallet.init({
      seed: nanoSeed,
      statePath: walletStatePath,
      indexStart: nanoAccountIndexStart
    });
  } catch (error) {
    console.error('Failed to initialize Nano wallet state', error);
    process.exit(1);
  }

  const rpcClient = new NanoRpcClient(nanoRpcUrl);
  paymentVerifier = new PaymentVerifier({
    wallet: getWallet(),
    rpc: rpcClient,
    minConfirmations: nanoMinConfirmations
  });
  void registerOfferWithRetry();

  connectWebSocket();
  startPolling();
};

void main();
