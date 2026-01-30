import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { sha256Hex, verifyCanonical } from '@nanobazaar/shared';
import { createDb, type JobStatus } from './db.js';
import './types.js';

const parseEnvInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

const BODY_LIMIT_BYTES = 300 * 1024;
const MAX_REQUEST_PAYLOAD_BYTES = 64 * 1024;
const MAX_RESULT_URL_LEN = 2048;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_TITLE_LEN = 120;
const MAX_DESC_LEN = 2000;
const MAX_TAGS = 16;
const MAX_TAG_LEN = 32;
const MAX_PRICE_LEN = 40;
const MAX_INVOICE_LEN = 128;
const MAX_PAYMENT_HASH_LEN = 128;
const MAX_PROVIDER_LEN = 32;
const MAX_IDEMPOTENCY_KEY_LEN = 128;

const QUOTE_TTL_MS = 15 * 60 * 1000;
const MAX_QUOTE_TTL_MS = 60 * 60 * 1000;
const LOCK_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_MAX_WAIT_MS = parseEnvInt('RELAY_HEARTBEAT_MAX_WAIT_MS', 30_000);
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const RATE_LIMIT_WINDOW_MS = parseEnvInt('RELAY_RATE_LIMIT_WINDOW_MS', 60_000);
const RATE_LIMIT_IP_MAX = parseEnvInt('RELAY_RATE_LIMIT_IP_MAX', 120);
const RATE_LIMIT_PUBKEY_MAX = parseEnvInt('RELAY_RATE_LIMIT_PUBKEY_MAX', 60);
const RATE_LIMIT_STRICT_MAX = parseEnvInt('RELAY_RATE_LIMIT_STRICT_MAX', 30);
const RATE_LIMIT_ENABLED =
  process.env.RELAY_RATE_LIMIT_ENABLED !== 'false';

const now = () => new Date();

const errorResponse = (
  code: string,
  message: string,
  details: Record<string, unknown> | null = null
) => ({
  error: {
    code,
    message,
    details
  }
});

const sendError = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> | null = null
) => reply.code(status).send(errorResponse(code, message, details));

const jsonByteLength = (value: unknown): number => {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
};

const requireJsonSize = (
  reply: FastifyReply,
  value: unknown,
  maxBytes: number,
  label: string
): boolean => {
  const bytes = jsonByteLength(value);
  if (bytes > maxBytes) {
    sendError(
      reply,
      413,
      'payload_too_large',
      `${label} exceeds ${maxBytes} bytes`,
      { bytes, maxBytes }
    );
    return false;
  }
  return true;
};

const isLowerHex = (value: string) => /^[0-9a-f]+$/.test(value);

type Metrics = {
  counters: Record<string, number>;
  inc: (name: string, labels?: Record<string, string>) => void;
  snapshot: () => { counters: Record<string, number> };
};

const formatMetricKey = (
  name: string,
  labels?: Record<string, string>
): string => {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return `${name}{${parts.join(',')}}`;
};

const createMetrics = (): Metrics => {
  const counters: Record<string, number> = {};
  return {
    counters,
    inc: (name, labels) => {
      const key = formatMetricKey(name, labels);
      counters[key] = (counters[key] ?? 0) + 1;
    },
    snapshot: () => ({ counters: { ...counters } })
  };
};

const parseResponsePayload = (payload: unknown): unknown => {
  if (payload === undefined || payload === null || payload === '') return null;
  if (Buffer.isBuffer(payload)) {
    const text = payload.toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return { raw: payload };
    }
  }
  return payload;
};

const requireHex = (
  reply: FastifyReply,
  value: string | undefined,
  length: number,
  code: string
): value is string => {
  if (!value || value.length !== length || !isLowerHex(value)) {
    sendError(reply, 401, code, 'Invalid authentication signature');
    return false;
  }
  return true;
};

export const buildServer = async (databaseUrl?: string) => {
  const server = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string' && header.length <= 64) {
        return header;
      }
      return randomBytes(16).toString('hex');
    }
  });
  const metrics = createMetrics();
  server.decorate('metrics', metrics);

  const rateBuckets = new Map<string, { tokens: number; last: number }>();
  let lastRateSweep = Date.now();

  const getPath = (request: FastifyRequest): string => {
    const rawPath = request.raw.url ?? request.url;
    return rawPath.split('?')[0] ?? rawPath;
  };

  const isRateLimitedPath = (request: FastifyRequest): boolean => {
    const path = getPath(request);
    return path.startsWith('/v1/');
  };

  const isStrictRateLimit = (request: FastifyRequest): boolean => {
    const path = getPath(request);
    return (
      request.method === 'POST' &&
      (path === '/v1/jobs' || path === '/v1/offers')
    );
  };

  const sweepRateBuckets = (now: number) => {
    if (now - lastRateSweep < RATE_LIMIT_WINDOW_MS) return;
    const expiry = RATE_LIMIT_WINDOW_MS * 2;
    for (const [key, bucket] of rateBuckets.entries()) {
      if (now - bucket.last > expiry) {
        rateBuckets.delete(key);
      }
    }
    lastRateSweep = now;
  };

  const takeRateLimit = (
    key: string,
    limit: number
  ): { allowed: boolean; retryAfterSeconds: number } => {
    if (limit <= 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
      };
    }
    const now = Date.now();
    sweepRateBuckets(now);
    const existing = rateBuckets.get(key) ?? { tokens: limit, last: now };
    const refillRate = limit / RATE_LIMIT_WINDOW_MS;
    const elapsed = now - existing.last;
    const tokens = Math.min(limit, existing.tokens + elapsed * refillRate);
    if (tokens < 1) {
      existing.tokens = tokens;
      existing.last = now;
      rateBuckets.set(key, existing);
      const retryAfterMs = Math.ceil((1 - tokens) / refillRate);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
      };
    }
    existing.tokens = tokens - 1;
    existing.last = now;
    rateBuckets.set(key, existing);
    return { allowed: true, retryAfterSeconds: 0 };
  };
  const sellerHeartbeatWaiters = new Map<string, Set<() => void>>();

  const notifySeller = (sellerPubkey: string) => {
    const waiters = sellerHeartbeatWaiters.get(sellerPubkey);
    if (!waiters || waiters.size === 0) return;
    for (const waiter of Array.from(waiters)) {
      try {
        waiter();
      } catch {
        // ignore waiter failures; cleanup is handled by waiters
      }
    }
  };

  const waitForSellerUpdate = (sellerPubkey: string, timeoutMs: number) => {
    if (timeoutMs <= 0) {
      return Promise.resolve('timeout' as const);
    }
    return new Promise<'notified' | 'timeout'>((resolve) => {
      const waiters =
        sellerHeartbeatWaiters.get(sellerPubkey) ?? new Set<() => void>();
      sellerHeartbeatWaiters.set(sellerPubkey, waiters);
      let settled = false;
      let timer: NodeJS.Timeout | null = null;

      const cleanup = (result: 'notified' | 'timeout') => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        waiters.delete(onNotify);
        if (waiters.size === 0) {
          sellerHeartbeatWaiters.delete(sellerPubkey);
        }
        resolve(result);
      };

      const onNotify = () => cleanup('notified');
      waiters.add(onNotify);
      timer = setTimeout(() => cleanup('timeout'), timeoutMs);
    });
  };

  const db = createDb(
    databaseUrl ??
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/nanobazaar_relay?sslmode=disable'
  );
  server.decorate('db', db);
  server.addHook('onClose', async () => {
    await db.destroy();
  });

  server.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (!RATE_LIMIT_ENABLED) return;
    if (!isRateLimitedPath(request)) return;

    const strict = isStrictRateLimit(request);
    const limit = strict ? RATE_LIMIT_STRICT_MAX : RATE_LIMIT_IP_MAX;
    const key = `ip:${request.ip}:${strict ? 'strict' : 'default'}`;
    const { allowed, retryAfterSeconds } = takeRateLimit(key, limit);
    if (!allowed) {
      reply.header('retry-after', retryAfterSeconds.toString());
      metrics.inc('rate_limited', {
        scope: 'ip',
        path: getPath(request),
        method: request.method
      });
      sendError(reply, 429, 'rate_limited', 'Rate limit exceeded', {
        scope: 'ip',
        limit,
        window_ms: RATE_LIMIT_WINDOW_MS
      });
      return;
    }
  });

  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
      request.rawBody = raw;
      if (raw.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(raw.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  await server.register(swagger, {
    openapi: {
      info: {
        title: 'NanoBazaar Relay',
        version: '0.0.0'
      }
    }
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs'
  });


  const authFail = (
    reply: FastifyReply,
    code: string,
    message: string,
    details: Record<string, unknown> | null = null
  ) => {
    metrics.inc('auth.failure', { code });
    sendError(reply, 401, code, message, details);
  };

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const pubkeyHeader = request.headers['x-molt-pubkey'];
    const timestampHeader = request.headers['x-molt-timestamp'];
    const nonceHeader = request.headers['x-molt-nonce'];
    const signatureHeader = request.headers['x-molt-signature'];

    const pubkey = typeof pubkeyHeader === 'string' ? pubkeyHeader : undefined;
    const timestamp =
      typeof timestampHeader === 'string' ? timestampHeader : undefined;
    const nonce = typeof nonceHeader === 'string' ? nonceHeader : undefined;
    const signature =
      typeof signatureHeader === 'string' ? signatureHeader : undefined;

    if (!requireHex(reply, pubkey, 64, 'auth.invalid_signature')) {
      metrics.inc('auth.failure', { code: 'auth.invalid_signature' });
      return;
    }
    if (!timestamp || !nonce) {
      authFail(reply, 'auth.invalid_signature', 'Missing auth headers');
      return;
    }
    if (!requireHex(reply, signature, 128, 'auth.invalid_signature')) {
      metrics.inc('auth.failure', { code: 'auth.invalid_signature' });
      return;
    }

    if (!isLowerHex(nonce) || nonce.length < 32 || nonce.length > 64) {
      authFail(reply, 'auth.invalid_signature', 'Invalid nonce');
      return;
    }

    const timestampNumber = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(timestampNumber)) {
      authFail(reply, 'auth.invalid_signature', 'Invalid timestamp');
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampNumber) > 60) {
      authFail(reply, 'auth.timestamp_skew', 'Timestamp skew too large');
      return;
    }

    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const path = request.raw.url ?? request.url;
    let verified = false;
    try {
      verified = verifyCanonical({
        method: request.method,
        path,
        timestamp,
        nonce,
        body: rawBody,
        publicKeyHex: pubkey,
        signatureHex: signature
      });
    } catch {
      verified = false;
    }

    if (!verified) {
      authFail(reply, 'auth.invalid_signature', 'Invalid signature');
      return;
    }

    await db
      .deleteFrom('nonces')
      .where(
        'created_at',
        '<',
        sql`now() - interval '10 minutes'`
      )
      .execute();

    const nonceHash = sha256Hex(new TextEncoder().encode(nonce));
    const insertResult = await db
      .insertInto('nonces')
      .values({ pubkey, nonce: nonceHash, created_at: now() })
      .onConflict((oc) => oc.columns(['pubkey', 'nonce']).doNothing())
      .executeTakeFirst();

    const inserted = Number(insertResult.numInsertedOrUpdatedRows ?? 0);
    if (inserted === 0) {
      authFail(reply, 'auth.nonce_replay', 'Nonce already used');
      return;
    }

    request.auth = { pubkey };

    if (RATE_LIMIT_ENABLED && isRateLimitedPath(request)) {
      const strict = isStrictRateLimit(request);
      const limit = strict ? RATE_LIMIT_STRICT_MAX : RATE_LIMIT_PUBKEY_MAX;
      const key = `pubkey:${pubkey}:${strict ? 'strict' : 'default'}`;
      const { allowed, retryAfterSeconds } = takeRateLimit(key, limit);
      if (!allowed) {
        reply.header('retry-after', retryAfterSeconds.toString());
        metrics.inc('rate_limited', {
          scope: 'pubkey',
          path: getPath(request),
          method: request.method
        });
        sendError(reply, 429, 'rate_limited', 'Rate limit exceeded', {
          scope: 'pubkey',
          limit,
          window_ms: RATE_LIMIT_WINDOW_MS
        });
        return;
      }
    }
  };

  const maybeSendIdempotencyResponse = (
    request: FastifyRequest,
    reply: FastifyReply
  ): boolean => {
    const response = request.idempotencyResponse;
    if (!response) return false;
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        reply.header(key, value);
      }
    }
    reply.code(response.status).send(response.body ?? null);
    return true;
  };

  const requireIdempotency = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const header = request.headers['idempotency-key'];
    if (header === undefined) return;
    const key =
      typeof header === 'string'
        ? header.trim()
        : Array.isArray(header)
          ? header[0]?.trim()
          : '';
    if (!key) {
      request.idempotencyResponse = {
        status: 400,
        body: errorResponse('validation_error', 'Idempotency-Key is required')
      };
      return;
    }
    if (key.length > MAX_IDEMPOTENCY_KEY_LEN) {
      request.idempotencyResponse = {
        status: 400,
        body: errorResponse('validation_error', 'Idempotency-Key too long', {
          max_length: MAX_IDEMPOTENCY_KEY_LEN
        })
      };
      return;
    }
    if (!request.auth) {
      return;
    }

    await db
      .deleteFrom('idempotency_keys')
      .where(
        'created_at',
        '<',
        new Date(Date.now() - IDEMPOTENCY_TTL_MS)
      )
      .execute();

    const target = request.raw.url ?? request.url;
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const requestHash = sha256Hex(
      Buffer.concat([Buffer.from(`${request.method}\n${target}\n`), rawBody])
    );

    const insertResult = await db
      .insertInto('idempotency_keys')
      .values({
        pubkey: request.auth.pubkey,
        idempotency_key: key,
        request_hash: requestHash,
        response_status: null,
        response_body: null,
        created_at: now()
      })
      .onConflict((oc) => oc.columns(['pubkey', 'idempotency_key']).doNothing())
      .executeTakeFirst();

    const inserted = Number(insertResult.numInsertedOrUpdatedRows ?? 0);
    if (inserted === 0) {
      const existing = await db
        .selectFrom('idempotency_keys')
        .selectAll()
        .where('pubkey', '=', request.auth.pubkey)
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (!existing) {
        request.idempotencyResponse = {
          status: 409,
          body: errorResponse(
            'idempotency_conflict',
            'Idempotency conflict'
          )
        };
        return;
      }
      if (existing.request_hash !== requestHash) {
        request.idempotencyResponse = {
          status: 409,
          body: errorResponse(
            'idempotency_conflict',
            'Idempotency key already used with different payload'
          )
        };
        return;
      }
      if (existing.response_status !== null) {
        request.idempotencyResponse = {
          status: existing.response_status,
          body: existing.response_body ?? null,
          headers: {
            'idempotency-key': key,
            'idempotency-replayed': 'true'
          }
        };
        return;
      }
      request.idempotencyResponse = {
        status: 409,
        body: errorResponse(
          'idempotency_in_progress',
          'Idempotent request is already in progress'
        )
      };
      return;
    }

    request.idempotency = {
      key,
      requestHash,
      pubkey: request.auth.pubkey
    };
    reply.header('idempotency-key', key);
  };

  const authWithIdempotency = [requireAuth, requireIdempotency];

  server.addHook('onSend', async (request, reply, payload) => {
    if (!reply.sent) {
      reply.hijack();
    }
    const info = request.idempotency;
    if (!info) return payload;
    const responseBody = parseResponsePayload(payload);
    try {
      await db
        .updateTable('idempotency_keys')
        .set({
          response_status: reply.statusCode,
          response_body: responseBody
        })
        .where('pubkey', '=', info.pubkey)
        .where('idempotency_key', '=', info.key)
        .execute();
    } catch (error) {
      console.error('Failed to persist idempotency response', error);
    }
    return payload;
  });

  const PricingModeSchema = z.enum(['fixed', 'quote']);
  const OfferCreateSchema = z
    .object({
      title: z.string().min(1).max(MAX_TITLE_LEN),
      description: z.string().min(1).max(MAX_DESC_LEN),
      tags: z.array(z.string().min(1).max(MAX_TAG_LEN)).max(MAX_TAGS).optional(),
      pricing_mode: PricingModeSchema,
      fixed_price_raw: z
        .string()
        .max(MAX_PRICE_LEN)
        .regex(/^[0-9]+$/)
        .nullable()
        .optional(),
      active: z.boolean().optional()
    })
    .superRefine((data, ctx) => {
      if (data.pricing_mode === 'fixed' && !data.fixed_price_raw) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'fixed_price_raw required for fixed pricing'
        });
      }
      if (data.pricing_mode === 'quote' && data.fixed_price_raw != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'fixed_price_raw must be null for quote pricing'
        });
      }
    });

  const JobCreateSchema = z.object({
    offer_id: z.string().uuid(),
    request_payload: z.unknown()
  });

  const QuoteSchema = z.object({
    quote_amount_raw: z.string().max(MAX_PRICE_LEN).regex(/^[0-9]+$/),
    quote_invoice_address: z.string().min(1).max(MAX_INVOICE_LEN),
    quote_expires_at: z.string().datetime().optional().nullable(),
    payment_charge_id: z
      .string()
      .min(1)
      .max(MAX_PAYMENT_HASH_LEN)
      .optional()
      .nullable(),
    payment_charge_address: z
      .string()
      .min(1)
      .max(MAX_INVOICE_LEN)
      .optional()
      .nullable(),
    payment_provider: z
      .string()
      .min(1)
      .max(MAX_PROVIDER_LEN)
      .optional()
      .nullable()
  });

  const PaymentSchema = z.object({
    payment_tx_hash: z.string().min(1).max(MAX_PAYMENT_HASH_LEN)
  });

  const DeliverSchema = z
    .object({
      result_url: z
        .string()
        .min(1)
        .max(MAX_RESULT_URL_LEN)
        .optional()
        .nullable(),
      error: z.unknown().optional().nullable()
    })
    .strict();

  const CancelSchema = z.object({
    reason: z.string().max(200).optional().nullable()
  });

  const getJobOr404 = async (
    jobId: string,
    reply: Fastify.FastifyReply
  ) => {
    const job = await db
      .selectFrom('jobs')
      .selectAll()
      .where('job_id', '=', jobId)
      .executeTakeFirst();
    if (!job) {
      sendError(reply, 404, 'not_found', 'Job not found');
      return null;
    }
    return job;
  };

  const updateJobStatus = async (jobId: string, status: JobStatus) =>
    db
      .updateTable('jobs')
      .set({ status })
      .where('job_id', '=', jobId)
      .returningAll()
      .executeTakeFirst();


  const recordJobTransition = (
    request: FastifyRequest,
    job: {
      job_id: string;
      seller_pubkey: string;
      buyer_pubkey: string;
    },
    fromStatus: JobStatus | null,
    toStatus: JobStatus
  ) => {
    if (fromStatus === toStatus) return;
    metrics.inc('job.transition', {
      from: fromStatus ?? 'none',
      to: toStatus
    });
    notifySeller(job.seller_pubkey);
    request.log.info(
      {
        request_id: request.id,
        job_id: job.job_id,
        seller_pubkey: job.seller_pubkey,
        buyer_pubkey: job.buyer_pubkey,
        from_status: fromStatus,
        to_status: toStatus
      },
      'job.transition'
    );
  };

  server.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            },
            required: ['ok']
          }
        }
      }
    },
    async () => ({ ok: true })
  );

  server.get('/metrics', async () => metrics.snapshot());

  server.post(
    '/v1/offers',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const parsed = OfferCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(reply, 400, 'validation_error', 'Invalid offer', {
          issues: parsed.error.flatten()
        });
        return;
      }
      const data = parsed.data;
      const offer = await db
        .insertInto('offers')
        .values({
          seller_pubkey: request.auth.pubkey,
          title: data.title,
          description: data.description,
          tags: data.tags ?? [],
          pricing_mode: data.pricing_mode,
          fixed_price_raw: data.fixed_price_raw ?? null,
          active: data.active ?? true
        })
        .returningAll()
        .executeTakeFirst();
      reply.code(201).send({ offer });
    }
  );

  server.get('/v1/offers', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const q = query.q?.trim();
    const tagsParam = query.tags?.trim();
    const sellerPubkey = query.seller_pubkey?.trim();
    const pricingMode = query.pricing_mode?.trim();
    const activeParam = query.active?.trim();
    const onlineOnlyParam = query.online_only?.trim();
    const limitParam = query.limit?.trim();
    const offsetParam = query.offset?.trim();

    const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      sendError(reply, 400, 'validation_error', 'Invalid limit');
      return;
    }
    if (!Number.isFinite(offset) || offset < 0) {
      sendError(reply, 400, 'validation_error', 'Invalid offset');
      return;
    }

    let active = true;
    if (activeParam !== undefined) {
      if (activeParam === 'true') active = true;
      else if (activeParam === 'false') active = false;
      else {
        sendError(reply, 400, 'validation_error', 'Invalid active flag');
        return;
      }
    }

    let onlineOnly = false;
    if (onlineOnlyParam !== undefined) {
      if (onlineOnlyParam === 'true') onlineOnly = true;
      else if (onlineOnlyParam === 'false') onlineOnly = false;
      else {
        sendError(reply, 400, 'validation_error', 'Invalid online_only flag');
        return;
      }
    }

    let tags: string[] = [];
    if (tagsParam) {
      tags = tagsParam
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (
        tags.length > MAX_TAGS ||
        tags.some((tag) => tag.length > MAX_TAG_LEN || tag.length === 0)
      ) {
        sendError(reply, 400, 'validation_error', 'Invalid tags');
        return;
      }
    }

    if (
      pricingMode !== undefined &&
      pricingMode !== 'fixed' &&
      pricingMode !== 'quote'
    ) {
      sendError(reply, 400, 'validation_error', 'Invalid pricing_mode');
      return;
    }

    let base = db.selectFrom('offers');
    if (q) {
      base = base.where((eb) =>
        eb.or([
          eb('title', 'ilike', `%${q}%`),
          eb('description', 'ilike', `%${q}%`)
        ])
      );
    }
    if (tags.length > 0) {
      base = base.where(
        sql<boolean>`tags @> ARRAY[${sql.join(tags)}]::text[]`
      );
    }
    if (sellerPubkey) {
      base = base.where('seller_pubkey', '=', sellerPubkey);
    }
    if (pricingMode) {
      base = base.where('pricing_mode', '=', pricingMode);
    }
    if (activeParam !== undefined) {
      base = base.where('active', '=', active);
    } else {
      base = base.where('active', '=', true);
    }
    if (onlineOnly) {
      const onlineKeys = Array.from(onlineSellers.keys());
      if (onlineKeys.length === 0) {
        reply.send({ offers: [], limit, offset, total: 0 });
        return;
      }
      base = base.where('seller_pubkey', 'in', onlineKeys);
    }

    const totalRow = await base
      .select((eb) => eb.fn.countAll().as('count'))
      .executeTakeFirst();
    const total = Number(totalRow?.count ?? 0);

    const offers = await base
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    reply.send({ offers, limit, offset, total });
  });

  server.post(
    '/v1/jobs',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const parsed = JobCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(reply, 400, 'validation_error', 'Invalid job', {
          issues: parsed.error.flatten()
        });
        return;
      }
      const data = parsed.data;
      if (
        !requireJsonSize(
          reply,
          data.request_payload,
          MAX_REQUEST_PAYLOAD_BYTES,
          'request_payload'
        )
      ) {
        return;
      }

      const offer = await db
        .selectFrom('offers')
        .selectAll()
        .where('offer_id', '=', data.offer_id)
        .executeTakeFirst();
      if (!offer) {
        sendError(reply, 404, 'not_found', 'Offer not found');
        return;
      }

      const job = await db
        .insertInto('jobs')
        .values({
          offer_id: offer.offer_id,
          seller_pubkey: offer.seller_pubkey,
          buyer_pubkey: request.auth.pubkey,
          status: 'requested',
          request_payload: data.request_payload,
          quote_amount_raw: null,
          quote_invoice_address: null,
          quote_expires_at: null,
          payment_tx_hash: null,
          payment_charge_id: null,
          payment_charge_address: null,
          payment_sweep_tx_hash: null,
          lock_owner: null,
          lock_expires_at: null,
          result_url: null,
          result_payload: null,
          error: null
        })
        .returningAll()
        .executeTakeFirst();
      if (job) {
        recordJobTransition(request, job, null, job.status);
      }
      reply.code(201).send({ job });
    }
  );

  server.get(
    '/v1/seller/heartbeat',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
      metrics.inc('heartbeat.request');
      const query = request.query as Record<string, string | undefined>;
      const statusParam = query.status?.trim();
      const limitParam = query.limit?.trim();
      const offsetParam = query.offset?.trim();
      const updatedAfterParam = query.updated_after?.trim();
      const waitParam = query.wait_ms?.trim();

      const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;
      const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

      if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
        sendError(reply, 400, 'validation_error', 'Invalid limit');
        return;
      }
      if (!Number.isFinite(offset) || offset < 0) {
        sendError(reply, 400, 'validation_error', 'Invalid offset');
        return;
      }

      let waitMs = waitParam ? Number.parseInt(waitParam, 10) : 0;
      if (!Number.isFinite(waitMs) || waitMs < 0) {
        sendError(reply, 400, 'validation_error', 'Invalid wait_ms');
        return;
      }
      if (waitMs > HEARTBEAT_MAX_WAIT_MS) {
        sendError(reply, 400, 'validation_error', 'wait_ms out of range', {
          max_wait_ms: HEARTBEAT_MAX_WAIT_MS
        });
        return;
      }

      let updatedAfter: Date | null = null;
      if (updatedAfterParam) {
        const parsed = new Date(updatedAfterParam);
        if (Number.isNaN(parsed.getTime())) {
          sendError(reply, 400, 'validation_error', 'Invalid updated_after');
          return;
        }
        updatedAfter = parsed;
      }

      const statusValues: JobStatus[] = [
        'requested',
        'quoted',
        'accepted',
        'running',
        'delivered',
        'failed',
        'canceled',
        'expired'
      ];

      let statuses: JobStatus[] = [];
      if (statusParam) {
        statuses = statusParam
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => value as JobStatus);
        if (
          statuses.length === 0 ||
          statuses.some((status) => !statusValues.includes(status))
        ) {
          sendError(reply, 400, 'validation_error', 'Invalid status filter');
          return;
        }
      } else {
        statuses = ['requested', 'accepted', 'running'];
      }

      const fetchJobs = async () => {
        let base = db
          .selectFrom('jobs')
          .where('seller_pubkey', '=', request.auth.pubkey);
        if (statuses.length > 0) {
          base = base.where('status', 'in', statuses);
        }
        if (updatedAfter) {
          base = base.where('updated_at', '>', updatedAfter);
        }

        const totalRow = await base
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirst();
        const total = Number(totalRow?.count ?? 0);

        let jobsQuery = base.selectAll();
        if (updatedAfter) {
          jobsQuery = jobsQuery.orderBy('updated_at', 'asc');
        } else {
          jobsQuery = jobsQuery.orderBy('created_at', 'desc');
        }

        const jobs = await jobsQuery.limit(limit).offset(offset).execute();
        return { jobs, total };
      };

      const startedAt = Date.now();
      let { jobs, total } = await fetchJobs();
      if (jobs.length === 0 && waitMs > 0) {
        metrics.inc('heartbeat.wait');
        const waitResult = await waitForSellerUpdate(
          request.auth.pubkey,
          waitMs
        );
        metrics.inc('heartbeat.wait_result', { result: waitResult });
        ({ jobs, total } = await fetchJobs());
      }

      reply.send({
        jobs,
        limit,
        offset,
        total,
        waited_ms: Date.now() - startedAt
      });
    }
  );

  server.get(
    '/v1/jobs',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
      const query = request.query as Record<string, string | undefined>;
      const statusParam = query.status?.trim();
      const roleParam = query.role?.trim();
      const limitParam = query.limit?.trim();
      const offsetParam = query.offset?.trim();
      const updatedAfterParam = query.updated_after?.trim();

      const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;
      const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

      if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
        sendError(reply, 400, 'validation_error', 'Invalid limit');
        return;
      }
      if (!Number.isFinite(offset) || offset < 0) {
        sendError(reply, 400, 'validation_error', 'Invalid offset');
        return;
      }

      if (roleParam && roleParam !== 'seller' && roleParam !== 'buyer') {
        sendError(reply, 400, 'validation_error', 'Invalid role');
        return;
      }

      let updatedAfter: Date | null = null;
      if (updatedAfterParam) {
        const parsed = new Date(updatedAfterParam);
        if (Number.isNaN(parsed.getTime())) {
          sendError(reply, 400, 'validation_error', 'Invalid updated_after');
          return;
        }
        updatedAfter = parsed;
      }

      const statusValues: JobStatus[] = [
        'requested',
        'quoted',
        'accepted',
        'running',
        'delivered',
        'failed',
        'canceled',
        'expired'
      ];

      let statuses: JobStatus[] = [];
      if (statusParam) {
        statuses = statusParam
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => value as JobStatus);
        if (
          statuses.length === 0 ||
          statuses.some((status) => !statusValues.includes(status))
        ) {
          sendError(reply, 400, 'validation_error', 'Invalid status filter');
          return;
        }
      }

      let base = db.selectFrom('jobs');
      if (roleParam === 'seller') {
        base = base.where('seller_pubkey', '=', request.auth.pubkey);
      } else if (roleParam === 'buyer') {
        base = base.where('buyer_pubkey', '=', request.auth.pubkey);
      } else {
        base = base.where((eb) =>
          eb.or([
            eb('seller_pubkey', '=', request.auth.pubkey),
            eb('buyer_pubkey', '=', request.auth.pubkey)
          ])
        );
      }

      if (statuses.length > 0) {
        base = base.where('status', 'in', statuses);
      }
      if (updatedAfter) {
        base = base.where('updated_at', '>', updatedAfter);
      }

      const totalRow = await base
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirst();
      const total = Number(totalRow?.count ?? 0);

      let jobsQuery = base.selectAll();
      if (updatedAfter) {
        jobsQuery = jobsQuery.orderBy('updated_at', 'asc');
      } else {
        jobsQuery = jobsQuery.orderBy('created_at', 'desc');
      }

      const jobs = await jobsQuery.limit(limit).offset(offset).execute();

      reply.send({ jobs, limit, offset, total });
    }
  );

  server.get(
    '/v1/jobs/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
      const jobId = (request.params as { id: string }).id;
      const job = await getJobOr404(jobId, reply);
      if (!job) return;
      if (
        job.buyer_pubkey !== request.auth.pubkey &&
        job.seller_pubkey !== request.auth.pubkey
      ) {
        sendError(reply, 403, 'forbidden', 'Access denied');
        return;
      }
      reply.send({ job });
    }
  );

  server.post(
    '/v1/jobs/:id/quote',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const jobId = (request.params as { id: string }).id;
      const parsed = QuoteSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(reply, 400, 'validation_error', 'Invalid quote', {
          issues: parsed.error.flatten()
        });
        return;
      }
      const job = await getJobOr404(jobId, reply);
      if (!job) return;
      if (job.seller_pubkey !== request.auth.pubkey) {
        sendError(reply, 403, 'forbidden', 'Access denied');
        return;
      }
      if (job.status !== 'requested') {
        sendError(reply, 409, 'invalid_state', 'Job not requestable');
        return;
      }

      const input = parsed.data;
      const quoteExpires = input.quote_expires_at
        ? new Date(input.quote_expires_at)
        : new Date(Date.now() + QUOTE_TTL_MS);
      if (Number.isNaN(quoteExpires.getTime())) {
        sendError(reply, 400, 'validation_error', 'Invalid quote_expires_at');
        return;
      }
      const ttlMs = quoteExpires.getTime() - Date.now();
      if (ttlMs <= 0 || ttlMs > MAX_QUOTE_TTL_MS) {
        sendError(reply, 400, 'validation_error', 'quote_expires_at out of range');
        return;
      }

      const paymentProvider =
        input.payment_provider !== undefined
          ? input.payment_provider
          : input.payment_charge_id || input.payment_charge_address
            ? 'berrypay'
            : undefined;

      const updated = await db
        .updateTable('jobs')
        .set({
          status: 'quoted',
          quote_amount_raw: input.quote_amount_raw,
          quote_invoice_address: input.quote_invoice_address,
          quote_expires_at: quoteExpires,
          ...(input.payment_charge_id !== undefined && {
            payment_charge_id: input.payment_charge_id
          }),
          ...(input.payment_charge_address !== undefined && {
            payment_charge_address: input.payment_charge_address
          }),
          ...(paymentProvider !== undefined && {
            payment_provider: paymentProvider
          })
        })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        recordJobTransition(request, updated, job.status, updated.status);
      }
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/accept',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const jobId = (request.params as { id: string }).id;
      const job = await getJobOr404(jobId, reply);
      if (!job) return;
      if (job.buyer_pubkey !== request.auth.pubkey) {
        sendError(reply, 403, 'forbidden', 'Access denied');
        return;
      }
      if (job.status !== 'quoted') {
        sendError(reply, 409, 'invalid_state', 'Job not quotable');
        return;
      }
      if (!job.quote_expires_at || job.quote_expires_at.getTime() <= Date.now()) {
        const expiredJob = await updateJobStatus(jobId, 'expired');
        if (expiredJob) {
          recordJobTransition(request, expiredJob, job.status, expiredJob.status);
        }
        sendError(reply, 409, 'invalid_state', 'Quote expired');
        return;
      }

      const updated = await db
        .updateTable('jobs')
        .set({ status: 'accepted' })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        recordJobTransition(request, updated, job.status, updated.status);
      }
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/payment',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const jobId = (request.params as { id: string }).id;
      const parsed = PaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(reply, 400, 'validation_error', 'Invalid payment', {
          issues: parsed.error.flatten()
        });
        return;
      }
      const job = await getJobOr404(jobId, reply);
      if (!job) return;
      if (job.buyer_pubkey !== request.auth.pubkey) {
        sendError(reply, 403, 'forbidden', 'Access denied');
        return;
      }
      if (job.status !== 'accepted') {
        sendError(reply, 409, 'invalid_state', 'Job not accepted');
        return;
      }
      if (job.payment_tx_hash) {
        sendError(reply, 409, 'invalid_state', 'Payment already recorded');
        return;
      }

      const updated = await db
        .updateTable('jobs')
        .set({ payment_tx_hash: parsed.data.payment_tx_hash })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      notifySeller(job.seller_pubkey);
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/lock',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const jobId = (request.params as { id: string }).id;
      const job = await getJobOr404(jobId, reply);
      if (!job) return;
      if (job.seller_pubkey !== request.auth.pubkey) {
        sendError(reply, 403, 'forbidden', 'Access denied');
        return;
      }
      if (job.status !== 'accepted' && job.status !== 'running') {
        sendError(reply, 409, 'invalid_state', 'Job not lockable');
        return;
      }
      if (!job.payment_tx_hash) {
        sendError(reply, 409, 'invalid_state', 'Payment not recorded');
        return;
      }

      const nowTime = Date.now();
      const lockExpired =
        !job.lock_expires_at || job.lock_expires_at.getTime() <= nowTime;
      const sameOwner = job.lock_owner === request.auth.pubkey;

      if (job.lock_owner && !lockExpired && !sameOwner) {
        sendError(reply, 409, 'invalid_state', 'Lock held by another seller');
        return;
      }

      const updated = await db
        .updateTable('jobs')
        .set({
          status: 'running',
          lock_owner: request.auth.pubkey,
          lock_expires_at: new Date(nowTime + LOCK_TTL_MS)
        })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        recordJobTransition(request, updated, job.status, updated.status);
      }
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/deliver',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const jobId = (request.params as { id: string }).id;
      const parsed = DeliverSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(reply, 400, 'validation_error', 'Invalid delivery', {
          issues: parsed.error.flatten()
        });
        return;
      }
      const job = await getJobOr404(jobId, reply);
      if (!job) return;
      if (job.seller_pubkey !== request.auth.pubkey) {
        sendError(reply, 403, 'forbidden', 'Access denied');
        return;
      }
      if (job.status !== 'running') {
        sendError(reply, 409, 'invalid_state', 'Job not running');
        return;
      }
      if (job.lock_owner !== request.auth.pubkey) {
        sendError(reply, 409, 'invalid_state', 'Lock not held by seller');
        return;
      }
      if (job.lock_expires_at && job.lock_expires_at.getTime() <= Date.now()) {
        sendError(reply, 409, 'invalid_state', 'Lock expired');
        return;
      }

      const { result_url, error } = parsed.data;
      const hasResult = result_url !== null && result_url !== undefined;
      const hasError = error !== null && error !== undefined;
      if ((hasResult && hasError) || (!hasResult && !hasError)) {
        sendError(
          reply,
          400,
          'validation_error',
          'Provide either result_url or error'
        );
        return;
      }

      if (hasError && !requireJsonSize(reply, error, MAX_ERROR_BYTES, 'error')) {
        return;
      }

      const updated = await db
        .updateTable('jobs')
        .set({
          status: hasResult ? 'delivered' : 'failed',
          result_url: hasResult ? result_url : null,
          result_payload: null,
          error: hasError ? error : null
        })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        recordJobTransition(request, updated, job.status, updated.status);
      }
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/cancel',
    { preHandler: authWithIdempotency },
    async (request, reply) => {
      if (reply.sent) return;
      if (!request.auth) return;
      if (maybeSendIdempotencyResponse(request, reply)) return;
      const jobId = (request.params as { id: string }).id;
      const parsed = CancelSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(reply, 400, 'validation_error', 'Invalid cancel', {
          issues: parsed.error.flatten()
        });
        return;
      }
      const job = await getJobOr404(jobId, reply);
      if (!job) return;
      if (job.buyer_pubkey !== request.auth.pubkey) {
        sendError(reply, 403, 'forbidden', 'Access denied');
        return;
      }
      if (!['requested', 'quoted', 'accepted'].includes(job.status)) {
        sendError(reply, 409, 'invalid_state', 'Job not cancelable');
        return;
      }

      const updated = await db
        .updateTable('jobs')
        .set({ status: 'canceled' })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        recordJobTransition(request, updated, job.status, updated.status);
      }
      reply.send({ job: updated });
    }
  );

  return server;
};
