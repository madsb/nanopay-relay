import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { sha256Hex, verifyCanonical, verifyNonce } from '@nanopay/shared';
import { createDb, type JobStatus } from './db.js';
import './types.js';

const BODY_LIMIT_BYTES = 300 * 1024;
const MAX_REQUEST_PAYLOAD_BYTES = 64 * 1024;
const MAX_RESULT_PAYLOAD_BYTES = 256 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_TITLE_LEN = 120;
const MAX_DESC_LEN = 2000;
const MAX_TAGS = 16;
const MAX_TAG_LEN = 32;
const MAX_PRICE_LEN = 40;
const MAX_INVOICE_LEN = 128;
const MAX_PAYMENT_HASH_LEN = 128;

const QUOTE_TTL_MS = 15 * 60 * 1000;
const MAX_QUOTE_TTL_MS = 60 * 60 * 1000;
const LOCK_TTL_MS = 5 * 60 * 1000;
const WS_CHALLENGE_TTL_MS = 30 * 1000;

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
  const server = Fastify({ logger: true, bodyLimit: BODY_LIMIT_BYTES });
  type WsSocket = {
    readyState: number;
    send: (data: string) => void;
    close: () => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
  };
  const onlineSellers = new Map<string, Set<WsSocket>>();
  const socketToSeller = new Map<WsSocket, string>();

  const addOnlineSeller = (sellerPubkey: string, socket: WsSocket) => {
    const existing = onlineSellers.get(sellerPubkey);
    if (existing) {
      existing.add(socket);
    } else {
      onlineSellers.set(sellerPubkey, new Set([socket]));
    }
    socketToSeller.set(socket, sellerPubkey);
  };

  const removeOnlineSeller = (socket: WsSocket) => {
    const sellerPubkey = socketToSeller.get(socket);
    if (!sellerPubkey) return;
    const sockets = onlineSellers.get(sellerPubkey);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        onlineSellers.delete(sellerPubkey);
      }
    }
    socketToSeller.delete(socket);
  };

  const sendHint = (sellerPubkey: string) => {
    const sockets = onlineSellers.get(sellerPubkey);
    if (!sockets) return;
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        try {
          socket.send(JSON.stringify({ type: 'hint.new_job' }));
        } catch {
          // ignore send errors; socket cleanup handled by close events
        }
      }
    }
  };

  const db = createDb(
    databaseUrl ??
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/nanopay_relay?sslmode=disable'
  );
  server.decorate('db', db);
  server.addHook('onClose', async () => {
    await db.destroy();
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
        title: 'NanoPay Relay',
        version: '0.0.0'
      }
    }
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs'
  });

  await server.register(websocket);

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

    if (
      !requireHex(reply, pubkey, 64, 'auth.invalid_signature') ||
      !timestamp ||
      !nonce ||
      !requireHex(reply, signature, 128, 'auth.invalid_signature')
    ) {
      return;
    }

    if (!isLowerHex(nonce) || nonce.length < 32 || nonce.length > 64) {
      sendError(reply, 401, 'auth.invalid_signature', 'Invalid nonce');
      return;
    }

    const timestampNumber = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(timestampNumber)) {
      sendError(reply, 401, 'auth.invalid_signature', 'Invalid timestamp');
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampNumber) > 60) {
      sendError(reply, 401, 'auth.timestamp_skew', 'Timestamp skew too large');
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
      sendError(reply, 401, 'auth.invalid_signature', 'Invalid signature');
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
      sendError(reply, 401, 'auth.nonce_replay', 'Nonce already used');
      return;
    }

    request.auth = { pubkey };
  };

  server.get(
    '/ws/seller',
    { websocket: true },
    (socket) => {
      const nonce = randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + WS_CHALLENGE_TTL_MS);

      const sendWs = (payload: Record<string, unknown>) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(payload));
        }
      };

      const sendWsError = (code: string, message: string) => {
        sendWs({ type: 'error', code, message });
        socket.close();
      };

      let authed = false;
      let challengeUsed = false;
      const expiryTimer = setTimeout(() => {
        if (!authed) {
          sendWsError('auth.expired_challenge', 'Auth challenge expired');
        }
      }, WS_CHALLENGE_TTL_MS);

      sendWs({
        type: 'auth.challenge',
        nonce,
        expires_at: expiresAt.toISOString(),
        server_time: new Date().toISOString()
      });

      const cleanup = () => {
        clearTimeout(expiryTimer);
        removeOnlineSeller(socket);
      };

      socket.on('message', (data) => {
        if (authed) {
          sendWsError('ws.unknown_type', 'Unexpected message');
          return;
        }

        const text =
          typeof data === 'string'
            ? data
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : String(data);
        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          sendWsError('ws.invalid_json', 'Invalid JSON');
          return;
        }

        if (
          !payload ||
          typeof payload !== 'object' ||
          Array.isArray(payload)
        ) {
          sendWsError('ws.invalid_message', 'Invalid message');
          return;
        }

        const message = payload as Record<string, unknown>;
        if (message.type !== 'auth.response') {
          sendWsError('ws.unknown_type', 'Unknown message type');
          return;
        }
        if (challengeUsed) {
          sendWsError('auth.invalid_signature', 'Challenge already used');
          return;
        }
        challengeUsed = true;

        if (Date.now() > expiresAt.getTime()) {
          sendWsError('auth.expired_challenge', 'Auth challenge expired');
          return;
        }

        const pubkey = message.pubkey;
        const signature = message.signature;
        if (
          typeof pubkey !== 'string' ||
          pubkey.length !== 64 ||
          !isLowerHex(pubkey)
        ) {
          sendWsError('auth.invalid_pubkey', 'Invalid pubkey');
          return;
        }
        if (
          typeof signature !== 'string' ||
          signature.length !== 128 ||
          !isLowerHex(signature)
        ) {
          sendWsError('auth.invalid_signature', 'Invalid signature');
          return;
        }

        let verified = false;
        try {
          verified = verifyNonce(nonce, signature, pubkey);
        } catch {
          verified = false;
        }
        if (!verified) {
          sendWsError('auth.invalid_signature', 'Invalid signature');
          return;
        }

        authed = true;
        clearTimeout(expiryTimer);
        addOnlineSeller(pubkey, socket);
        sendWs({ type: 'auth.ok', seller_pubkey: pubkey });
      });

      socket.on('close', cleanup);
      socket.on('error', cleanup);
    }
  );

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
    quote_expires_at: z.string().datetime().optional().nullable()
  });

  const PaymentSchema = z.object({
    payment_tx_hash: z.string().min(1).max(MAX_PAYMENT_HASH_LEN)
  });

  const DeliverSchema = z.object({
    result_payload: z.unknown().nullable(),
    error: z.unknown().nullable()
  });

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

  server.post(
    '/v1/offers',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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
          lock_owner: null,
          lock_expires_at: null,
          result_payload: null,
          error: null
        })
        .returningAll()
        .executeTakeFirst();
      sendHint(offer.seller_pubkey);
      reply.code(201).send({ job });
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

      const totalRow = await base
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirst();
      const total = Number(totalRow?.count ?? 0);

      const jobs = await base
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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

      const updated = await db
        .updateTable('jobs')
        .set({
          status: 'quoted',
          quote_amount_raw: input.quote_amount_raw,
          quote_invoice_address: input.quote_invoice_address,
          quote_expires_at: quoteExpires
        })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/accept',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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
        await updateJobStatus(jobId, 'expired');
        sendError(reply, 409, 'invalid_state', 'Quote expired');
        return;
      }

      const updated = await db
        .updateTable('jobs')
        .set({ status: 'accepted' })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      sendHint(job.seller_pubkey);
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/payment',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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
      sendHint(job.seller_pubkey);
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/lock',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/deliver',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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

      const { result_payload, error } = parsed.data;
      const hasResult = result_payload !== null && result_payload !== undefined;
      const hasError = error !== null && error !== undefined;
      if ((hasResult && hasError) || (!hasResult && !hasError)) {
        sendError(
          reply,
          400,
          'validation_error',
          'Provide either result_payload or error'
        );
        return;
      }

      if (
        hasResult &&
        !requireJsonSize(
          reply,
          result_payload,
          MAX_RESULT_PAYLOAD_BYTES,
          'result_payload'
        )
      ) {
        return;
      }
      if (hasError && !requireJsonSize(reply, error, MAX_ERROR_BYTES, 'error')) {
        return;
      }

      const updated = await db
        .updateTable('jobs')
        .set({
          status: hasResult ? 'delivered' : 'failed',
          result_payload: hasResult ? result_payload : null,
          error: hasError ? error : null
        })
        .where('job_id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      reply.send({ job: updated });
    }
  );

  server.post(
    '/v1/jobs/:id/cancel',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;
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
      reply.send({ job: updated });
    }
  );

  return server;
};
