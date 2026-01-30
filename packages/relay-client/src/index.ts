import { randomBytes } from 'node:crypto';
import { fetch as undiciFetch } from 'undici';
import {
  publicKeyFromPrivateKeyHex,
  signCanonical
} from '@nanobazaar/shared';

export type PricingMode = 'fixed' | 'quote';

export type Offer = {
  offer_id: string;
  seller_pubkey: string;
  title: string;
  description: string;
  tags: string[];
  pricing_mode: PricingMode;
  fixed_price_raw: string | null;
  active: boolean;
  created_at: string;
};

export type JobStatus =
  | 'requested'
  | 'quoted'
  | 'accepted'
  | 'running'
  | 'delivered'
  | 'failed'
  | 'canceled'
  | 'expired';

export type Job = {
  job_id: string;
  offer_id: string;
  seller_pubkey: string;
  buyer_pubkey: string;
  status: JobStatus;
  request_payload: unknown;
  quote_amount_raw: string | null;
  quote_invoice_address: string | null;
  quote_expires_at: string | null;
  payment_tx_hash: string | null;
  payment_charge_id: string | null;
  payment_charge_address: string | null;
  payment_provider: string | null;
  payment_sweep_tx_hash: string | null;
  lock_owner: string | null;
  lock_expires_at: string | null;
  result_url: string | null;
  error: unknown | null;
  created_at: string;
  updated_at: string;
};

export type RelayError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  raw?: unknown;
};

export type RelayResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: RelayError };

export type RelayClientOptions = {
  baseUrl: string;
  privateKeyHex?: string;
  publicKeyHex?: string;
  fetch?: typeof undiciFetch;
  userAgent?: string;
};

export type OfferCreate = {
  title: string;
  description: string;
  tags?: string[];
  pricing_mode: PricingMode;
  fixed_price_raw?: string | null;
  active?: boolean;
};

export type OfferListParams = {
  q?: string;
  tags?: string[] | string;
  seller_pubkey?: string;
  pricing_mode?: PricingMode;
  active?: boolean;
  online_only?: boolean;
  limit?: number;
  offset?: number;
};

export type JobCreate = {
  offer_id: string;
  request_payload: unknown;
};

export type JobListParams = {
  status?: JobStatus[] | string;
  role?: 'seller' | 'buyer';
  limit?: number;
  offset?: number;
  updated_after?: string;
};

export type QuoteInput = {
  quote_amount_raw: string;
  quote_invoice_address: string;
  quote_expires_at?: string | null;
  payment_charge_id?: string | null;
  payment_charge_address?: string | null;
  payment_provider?: string | null;
};

export type PaymentInput = {
  payment_tx_hash: string;
};

export type DeliverInput = {
  result_url?: string | null;
  error?: unknown | null;
};

export type CancelInput = {
  reason?: string | null;
};

export type RelayClient = {
  buildAuthHeaders: (method: string, path: string, body: Buffer) => Record<string, string>;
  request: <T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { auth?: boolean }
  ) => Promise<RelayResult<T>>;
  createOffer: (offer: OfferCreate) => Promise<RelayResult<{ offer: Offer }>>;
  listOffers: (params?: OfferListParams) => Promise<
    RelayResult<{ offers: Offer[]; limit: number; offset: number; total: number }>
  >;
  createJob: (input: JobCreate) => Promise<RelayResult<{ job: Job }>>;
  listJobs: (params?: JobListParams) => Promise<
    RelayResult<{ jobs: Job[]; limit: number; offset: number; total: number }>
  >;
  getJob: (jobId: string) => Promise<RelayResult<{ job: Job }>>;
  quoteJob: (jobId: string, input: QuoteInput) => Promise<RelayResult<{ job: Job }>>;
  acceptJob: (jobId: string) => Promise<RelayResult<{ job: Job }>>;
  submitPayment: (
    jobId: string,
    input: PaymentInput
  ) => Promise<RelayResult<{ job: Job }>>;
  lockJob: (jobId: string) => Promise<RelayResult<{ job: Job }>>;
  deliverJob: (jobId: string, input: DeliverInput) => Promise<RelayResult<{ job: Job }>>;
  cancelJob: (jobId: string, input?: CancelInput) => Promise<RelayResult<{ job: Job }>>;
};

const trimBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, '');

const toQueryString = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
      continue;
    }
    if (typeof value === 'boolean') {
      search.set(key, value ? 'true' : 'false');
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
};

const normalizeError = (status: number, payload: unknown): RelayError => {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const candidate = (payload as { error: unknown }).error;
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      const code = typeof record.code === 'string' ? record.code : 'unknown_error';
      const message =
        typeof record.message === 'string'
          ? record.message
          : 'Request failed';
      return {
        status,
        code,
        message,
        details: record.details,
        raw: payload
      };
    }
  }
  if (status === 0) {
    return {
      status,
      code: 'network_error',
      message: 'Network request failed',
      details: payload,
      raw: payload
    };
  }
  return {
    status,
    code: 'http_error',
    message: `Request failed with status ${status}`,
    details: payload,
    raw: payload
  };
};

export const buildAuthHeaders = (
  method: string,
  path: string,
  body: Buffer,
  privateKeyHex: string,
  publicKeyHex?: string
): Record<string, string> => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const pubkey = publicKeyHex ?? publicKeyFromPrivateKeyHex(privateKeyHex);
  const signature = signCanonical({
    method,
    path,
    timestamp,
    nonce,
    body,
    privateKeyHex
  });

  return {
    'x-molt-pubkey': pubkey,
    'x-molt-timestamp': timestamp,
    'x-molt-nonce': nonce,
    'x-molt-signature': signature
  };
};

export const createRelayClient = (options: RelayClientOptions): RelayClient => {
  const baseUrl = trimBaseUrl(options.baseUrl);
  const privateKeyHex = options.privateKeyHex;
  const publicKeyHex = options.publicKeyHex;
  const fetcher = options.fetch ?? undiciFetch;
  const userAgent = options.userAgent;

  const buildHeaders = (method: string, path: string, body: Buffer) => {
    if (!privateKeyHex) {
      throw new Error('privateKeyHex is required for authenticated requests');
    }
    return buildAuthHeaders(method, path, body, privateKeyHex, publicKeyHex);
  };

  const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { auth?: boolean }
  ): Promise<RelayResult<T>> => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const rawBody = payload ? Buffer.from(payload) : Buffer.alloc(0);
    const headers: Record<string, string> = {};
    if (opts?.auth) {
      Object.assign(headers, buildHeaders(method, path, rawBody));
    }
    if (payload) {
      headers['content-type'] = 'application/json';
    }
    if (userAgent) {
      headers['user-agent'] = userAgent;
    }

    try {
      const response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers,
        body: payload
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          return {
            ok: false,
            status: response.status,
            error: {
              status: response.status,
              code: 'invalid_json',
              message: 'Response was not valid JSON',
              details: { error: String(error) },
              raw: text
            }
          };
        }
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: normalizeError(response.status, parsed)
        };
      }

      return { ok: true, status: response.status, data: parsed as T };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: normalizeError(0, { error: String(error) })
      };
    }
  };

  return {
    buildAuthHeaders: buildHeaders,
    request,
    createOffer: (offer) => request('POST', '/v1/offers', offer, { auth: true }),
    listOffers: (params = {}) =>
      request(
        'GET',
        `/v1/offers${toQueryString({
          q: params.q,
          tags: params.tags,
          seller_pubkey: params.seller_pubkey,
          pricing_mode: params.pricing_mode,
          active: params.active,
          online_only: params.online_only,
          limit: params.limit,
          offset: params.offset
        })}`
      ),
    createJob: (input) => request('POST', '/v1/jobs', input, { auth: true }),
    listJobs: (params = {}) =>
      request(
        'GET',
        `/v1/jobs${toQueryString({
          status: params.status,
          role: params.role,
          limit: params.limit,
          offset: params.offset,
          updated_after: params.updated_after
        })}`,
        undefined,
        { auth: true }
      ),
    getJob: (jobId) => request('GET', `/v1/jobs/${jobId}`, undefined, { auth: true }),
    quoteJob: (jobId, input) =>
      request('POST', `/v1/jobs/${jobId}/quote`, input, { auth: true }),
    acceptJob: (jobId) =>
      request('POST', `/v1/jobs/${jobId}/accept`, {}, { auth: true }),
    submitPayment: (jobId, input) =>
      request('POST', `/v1/jobs/${jobId}/payment`, input, { auth: true }),
    lockJob: (jobId) => request('POST', `/v1/jobs/${jobId}/lock`, {}, { auth: true }),
    deliverJob: (jobId, input) =>
      request('POST', `/v1/jobs/${jobId}/deliver`, input, { auth: true }),
    cancelJob: (jobId, input = {}) =>
      request('POST', `/v1/jobs/${jobId}/cancel`, input, { auth: true })
  };
};
