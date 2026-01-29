import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db';
import { cancelSchema, deliverSchema, jobCreateSchema, paymentSchema, quoteSchema, jsonByteLength } from '../validators';
import { forbiddenError, invalidStateError, notFoundError, payloadTooLargeError, sendError, validationError } from '../http';
import { LIMITS } from '../limits';
import { expireJobIfNeeded, fetchJobForUpdate } from '../jobs';

const ensureAuth = (request: FastifyRequest, reply: FastifyReply) => {
  const pubkey = request.molt?.pubkey;
  if (!pubkey) {
    sendError(reply, 401, 'auth.invalid_signature', 'Missing authentication', null);
    return null;
  }
  return pubkey;
};

const getJobId = (request: FastifyRequest) => (request.params as { id: string }).id;

export const registerJobRoutes = (
  app: FastifyInstance,
  db: Kysely<Database>,
  authGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void,
  notifySeller: (sellerPubkey: string) => void
) => {
  app.post('/jobs', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const parsed = jobCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, 'Invalid job payload', parsed.error.flatten());
    }

    const payloadSize = jsonByteLength(parsed.data.request_payload);
    if (payloadSize > LIMITS.requestPayloadMaxBytes) {
      return payloadTooLargeError(reply, 'request_payload exceeds limit');
    }

    const offer = await db
      .selectFrom('offers')
      .selectAll()
      .where('offer_id', '=', parsed.data.offer_id)
      .where('active', '=', true)
      .executeTakeFirst();

    if (!offer) {
      return notFoundError(reply, 'Offer not found');
    }

    const job = await db
      .insertInto('jobs')
      .values({
        offer_id: offer.offer_id,
        seller_pubkey: offer.seller_pubkey,
        buyer_pubkey: pubkey,
        status: 'requested',
        request_payload: parsed.data.request_payload,
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
      .executeTakeFirstOrThrow();

    notifySeller(offer.seller_pubkey);

    return reply.status(201).send({ job });
  });

  app.post('/jobs/:id/quote', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, 'Invalid quote payload', parsed.error.flatten());
    }

    const now = new Date();
    const requestedExpiry = parsed.data.quote_expires_at
      ? new Date(parsed.data.quote_expires_at)
      : new Date(now.getTime() + LIMITS.quoteTtlDefaultMs);

    if (Number.isNaN(requestedExpiry.getTime())) {
      return validationError(reply, 'Invalid quote_expires_at');
    }

    if (requestedExpiry <= now) {
      return validationError(reply, 'quote_expires_at must be in the future');
    }

    if (requestedExpiry.getTime() - now.getTime() > LIMITS.quoteTtlMaxMs) {
      return validationError(reply, 'quote_expires_at exceeds max TTL');
    }

    const result = await db.transaction().execute(async (trx) => {
      const row = await fetchJobForUpdate(trx, getJobId(request));
      if (!row) return null;
      const refreshed = await expireJobIfNeeded(trx, row, now);
      if (refreshed.seller_pubkey !== pubkey) {
        return { job: refreshed, authorized: false };
      }
      if (refreshed.status !== 'requested') return { job: refreshed, authorized: true };
      const updated = await trx
        .updateTable('jobs')
        .set({
          status: 'quoted',
          quote_amount_raw: parsed.data.quote_amount_raw,
          quote_invoice_address: parsed.data.quote_invoice_address,
          quote_expires_at: requestedExpiry
        })
        .where('job_id', '=', refreshed.job_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { job: updated, authorized: true };
    });

    if (!result) {
      return notFoundError(reply, 'Job not found');
    }
    if (!result.authorized) {
      return forbiddenError(reply, 'Not job seller');
    }
    const job = result.job;
    if (job.status !== 'quoted') {
      return invalidStateError(reply, 'Job not in requested state');
    }

    return reply.send({ job });
  });

  app.post('/jobs/:id/accept', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const now = new Date();
    const result = await db.transaction().execute(async (trx) => {
      const row = await fetchJobForUpdate(trx, getJobId(request));
      if (!row) return null;
      const refreshed = await expireJobIfNeeded(trx, row, now);
      if (refreshed.buyer_pubkey !== pubkey) {
        return { job: refreshed, authorized: false };
      }
      if (refreshed.status !== 'quoted') return { job: refreshed, authorized: true };
      if (refreshed.quote_expires_at && refreshed.quote_expires_at <= now) {
        const expired = await trx
          .updateTable('jobs')
          .set({ status: 'expired' })
          .where('job_id', '=', refreshed.job_id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return { job: expired, authorized: true };
      }
      const updated = await trx
        .updateTable('jobs')
        .set({ status: 'accepted' })
        .where('job_id', '=', refreshed.job_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { job: updated, authorized: true };
    });

    if (!result) {
      return notFoundError(reply, 'Job not found');
    }
    if (!result.authorized) {
      return forbiddenError(reply, 'Not job buyer');
    }
    const job = result.job;
    if (job.status !== 'accepted') {
      return invalidStateError(reply, 'Job not in quoted state');
    }

    return reply.send({ job });
  });

  app.post('/jobs/:id/payment', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const parsed = paymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, 'Invalid payment payload', parsed.error.flatten());
    }

    const now = new Date();
    const result = await db.transaction().execute(async (trx) => {
      const row = await fetchJobForUpdate(trx, getJobId(request));
      if (!row) return null;
      const refreshed = await expireJobIfNeeded(trx, row, now);
      if (refreshed.buyer_pubkey !== pubkey) {
        return { job: refreshed, authorized: false };
      }
      if (refreshed.status !== 'accepted') return { job: refreshed, authorized: true };
      if (refreshed.payment_tx_hash) return { job: refreshed, authorized: true };
      const updated = await trx
        .updateTable('jobs')
        .set({ payment_tx_hash: parsed.data.payment_tx_hash })
        .where('job_id', '=', refreshed.job_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { job: updated, authorized: true };
    });

    if (!result) {
      return notFoundError(reply, 'Job not found');
    }
    if (!result.authorized) {
      return forbiddenError(reply, 'Not job buyer');
    }
    const job = result.job;
    if (job.status !== 'accepted') {
      return invalidStateError(reply, 'Job not in accepted state');
    }
    if (job.payment_tx_hash && job.payment_tx_hash !== parsed.data.payment_tx_hash) {
      return invalidStateError(reply, 'Payment already submitted');
    }

    return reply.send({ job });
  });

  app.post('/jobs/:id/lock', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const now = new Date();
    const result = await db.transaction().execute(async (trx) => {
      const row = await fetchJobForUpdate(trx, getJobId(request));
      if (!row) return null;
      const refreshed = await expireJobIfNeeded(trx, row, now);
      if (refreshed.seller_pubkey !== pubkey) {
        return { job: refreshed, authorized: false };
      }
      if (refreshed.status === 'accepted') {
        if (!refreshed.payment_tx_hash) return { job: refreshed, authorized: true };
        const updated = await trx
          .updateTable('jobs')
          .set({
            status: 'running',
            lock_owner: pubkey,
            lock_expires_at: new Date(now.getTime() + LIMITS.lockTtlMs)
          })
          .where('job_id', '=', refreshed.job_id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return { job: updated, authorized: true };
      }
      if (refreshed.status === 'running') {
        if (refreshed.lock_owner !== pubkey) return { job: refreshed, authorized: true };
        if (refreshed.lock_expires_at && refreshed.lock_expires_at <= now) {
          const updated = await trx
            .updateTable('jobs')
            .set({
              lock_owner: pubkey,
              lock_expires_at: new Date(now.getTime() + LIMITS.lockTtlMs)
            })
            .where('job_id', '=', refreshed.job_id)
            .returningAll()
            .executeTakeFirstOrThrow();
          return { job: updated, authorized: true };
        }
        const updated = await trx
          .updateTable('jobs')
          .set({ lock_expires_at: new Date(now.getTime() + LIMITS.lockTtlMs) })
          .where('job_id', '=', refreshed.job_id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return { job: updated, authorized: true };
      }
      return { job: refreshed, authorized: true };
    });

    if (!result) {
      return notFoundError(reply, 'Job not found');
    }
    if (!result.authorized) {
      return forbiddenError(reply, 'Not job seller');
    }
    const job = result.job;
    if (job.status !== 'running') {
      return invalidStateError(reply, 'Job not ready for locking');
    }

    if (job.lock_owner !== pubkey) {
      return invalidStateError(reply, 'Job lock held by another seller');
    }

    return reply.send({ job });
  });

  app.post('/jobs/:id/deliver', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const parsed = deliverSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, 'Invalid delivery payload', parsed.error.flatten());
    }

    if (parsed.data.result_payload) {
      const size = jsonByteLength(parsed.data.result_payload);
      if (size > LIMITS.resultPayloadMaxBytes) {
        return payloadTooLargeError(reply, 'result_payload exceeds limit');
      }
    }

    if (parsed.data.error) {
      const size = jsonByteLength(parsed.data.error);
      if (size > LIMITS.errorPayloadMaxBytes) {
        return payloadTooLargeError(reply, 'error exceeds limit');
      }
    }

    const now = new Date();
    const result = await db.transaction().execute(async (trx) => {
      const row = await fetchJobForUpdate(trx, getJobId(request));
      if (!row) return null;
      const refreshed = await expireJobIfNeeded(trx, row, now);
      if (refreshed.seller_pubkey !== pubkey) {
        return { job: refreshed, authorized: false };
      }
      if (refreshed.status !== 'running') return { job: refreshed, authorized: true };
      if (refreshed.lock_owner !== pubkey) return { job: refreshed, authorized: true };
      if (refreshed.lock_expires_at && refreshed.lock_expires_at <= now) return { job: refreshed, authorized: true };
      const updated = await trx
        .updateTable('jobs')
        .set({
          status: parsed.data.result_payload ? 'delivered' : 'failed',
          result_payload: parsed.data.result_payload ?? null,
          error: parsed.data.error ?? null
        })
        .where('job_id', '=', refreshed.job_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { job: updated, authorized: true };
    });

    if (!result) {
      return notFoundError(reply, 'Job not found');
    }
    if (!result.authorized) {
      return forbiddenError(reply, 'Not job seller');
    }
    const job = result.job;
    if (job.status !== 'delivered' && job.status !== 'failed') {
      return invalidStateError(reply, 'Job not in running state');
    }

    return reply.send({ job });
  });

  app.post('/jobs/:id/cancel', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const parsed = cancelSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, 'Invalid cancel payload', parsed.error.flatten());
    }

    const now = new Date();
    const result = await db.transaction().execute(async (trx) => {
      const row = await fetchJobForUpdate(trx, getJobId(request));
      if (!row) return null;
      const refreshed = await expireJobIfNeeded(trx, row, now);
      if (refreshed.buyer_pubkey !== pubkey) {
        return { job: refreshed, authorized: false };
      }
      if (!['requested', 'quoted', 'accepted'].includes(refreshed.status)) return { job: refreshed, authorized: true };
      const updated = await trx
        .updateTable('jobs')
        .set({ status: 'canceled', lock_owner: null, lock_expires_at: null })
        .where('job_id', '=', refreshed.job_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { job: updated, authorized: true };
    });

    if (!result) {
      return notFoundError(reply, 'Job not found');
    }
    if (!result.authorized) {
      return forbiddenError(reply, 'Not job buyer');
    }
    const job = result.job;
    if (job.status !== 'canceled') {
      return invalidStateError(reply, 'Job not cancelable');
    }

    return reply.send({ job });
  });

  app.get('/jobs/:id', { preValidation: authGuard }, async (request, reply) => {
    const pubkey = ensureAuth(request, reply);
    if (!pubkey) return;

    const now = new Date();
    const job = await db.transaction().execute(async (trx) => {
      const row = await fetchJobForUpdate(trx, getJobId(request));
      if (!row) return null;
      return expireJobIfNeeded(trx, row, now);
    });

    if (!job) {
      return notFoundError(reply, 'Job not found');
    }

    if (job.buyer_pubkey !== pubkey && job.seller_pubkey !== pubkey) {
      return forbiddenError(reply, 'Not job participant');
    }

    return reply.send({ job });
  });
};
