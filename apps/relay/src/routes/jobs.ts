import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { JOB_STATUS, LIMITS } from "../constants.js";
import { HttpError, errorResponse } from "../errors.js";
import {
  enforceJsonSize,
  parseDate,
  secondsFromNow,
  nowUtc
} from "../utils.js";

type JobParams = {
  id: string;
};

const jobCreateSchema = z.object({
  offer_id: z.string().uuid(),
  request_payload: z.unknown()
});

const quoteSchema = z.object({
  quote_amount_raw: z.string().min(1).max(LIMITS.priceMax),
  quote_invoice_address: z.string().min(1).max(LIMITS.invoiceMax),
  quote_expires_at: z.string().datetime().nullable().optional()
});

const paymentSchema = z.object({
  payment_tx_hash: z.string().min(1).max(LIMITS.paymentHashMax)
});

const deliverSchema = z
  .object({
    result_payload: z.unknown().nullable(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().nullable().optional()
      })
      .nullable()
  })
  .superRefine((val, ctx) => {
    const hasResult = val.result_payload != null;
    const hasError = val.error != null;
    if (hasResult === hasError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either result_payload or error"
      });
    }
  });

const cancelSchema = z.object({
  reason: z.string().nullable().optional()
});

const serializeJob = (job: Record<string, unknown>) => ({
  ...job,
  created_at: job.created_at instanceof Date ? job.created_at.toISOString() : job.created_at,
  updated_at: job.updated_at instanceof Date ? job.updated_at.toISOString() : job.updated_at,
  quote_expires_at:
    job.quote_expires_at instanceof Date
      ? job.quote_expires_at.toISOString()
      : job.quote_expires_at,
  lock_expires_at:
    job.lock_expires_at instanceof Date
      ? job.lock_expires_at.toISOString()
      : job.lock_expires_at
});

const fetchJob = async (app: FastifyInstance, jobId: string) =>
  app.db.selectFrom("jobs").selectAll().where("job_id", "=", jobId).executeTakeFirst();

const maybeExpireJob = async (app: FastifyInstance, job: Record<string, unknown>) => {
  const status = job.status as string;
  const now = nowUtc();

  if (status === JOB_STATUS.quoted) {
    const expiresAt = parseDate(job.quote_expires_at as string | Date | null);
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      await app.db
        .updateTable("jobs")
        .set({ status: JOB_STATUS.expired })
        .where("job_id", "=", job.job_id as string)
        .execute();
      return fetchJob(app, job.job_id as string);
    }
  }

  if (status === JOB_STATUS.accepted && job.payment_tx_hash == null) {
    const updatedAt = parseDate(job.updated_at as string | Date | null);
    if (updatedAt) {
      const cutoff = new Date(
        updatedAt.getTime() + LIMITS.paymentTtlSeconds * 1000
      );
      if (cutoff.getTime() <= now.getTime()) {
        await app.db
          .updateTable("jobs")
          .set({ status: JOB_STATUS.expired })
          .where("job_id", "=", job.job_id as string)
          .execute();
        return fetchJob(app, job.job_id as string);
      }
    }
  }

  return job;
};

const ensureAuthorized = (job: Record<string, unknown>, pubkey: string) => {
  if (job.buyer_pubkey !== pubkey && job.seller_pubkey !== pubkey) {
    throw new HttpError(403, "forbidden", "Not allowed");
  }
};

export const registerJobRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/jobs",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const body = jobCreateSchema.parse(request.body ?? {});
      enforceJsonSize(body.request_payload, LIMITS.requestPayloadMaxBytes, "request_payload");

      const offer = await request.server.db
        .selectFrom("offers")
        .selectAll()
        .where("offer_id", "=", body.offer_id)
        .executeTakeFirst();

      if (!offer) {
        reply.code(404).send(errorResponse("not_found", "Offer not found"));
        return;
      }

      if (!offer.active) {
        reply.code(409).send(errorResponse("invalid_state", "Offer is inactive"));
        return;
      }

      const inserted = await request.server.db
        .insertInto("jobs")
        .values({
          offer_id: offer.offer_id,
          seller_pubkey: offer.seller_pubkey,
          buyer_pubkey: request.auth.pubkey,
          status: JOB_STATUS.requested,
          request_payload: body.request_payload
        })
        .returningAll()
        .executeTakeFirst();

      if (!inserted) {
        throw new HttpError(500, "internal_error", "Failed to create job");
      }

      reply.code(201).send({ job: serializeJob(inserted) });
    }
  );

  app.post(
    "/v1/jobs/:id/quote",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const body = quoteSchema.parse(request.body ?? {});
      const jobId = (request.params as JobParams).id;
      const job = await fetchJob(request.server, jobId);

      if (!job) {
        reply.code(404).send(errorResponse("not_found", "Job not found"));
        return;
      }

      if (job.seller_pubkey !== request.auth.pubkey) {
        reply.code(403).send(errorResponse("forbidden", "Not allowed"));
        return;
      }

      if (job.status !== JOB_STATUS.requested) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job is not requestable"));
        return;
      }

      const now = nowUtc();
      let expiresAt = body.quote_expires_at
        ? parseDate(body.quote_expires_at)
        : secondsFromNow(LIMITS.quoteTtlSeconds);

      if (!expiresAt) {
        throw new HttpError(400, "validation_error", "Invalid quote_expires_at");
      }

      const maxExpiry = new Date(
        now.getTime() + LIMITS.quoteTtlMaxSeconds * 1000
      );

      if (expiresAt.getTime() > maxExpiry.getTime()) {
        throw new HttpError(400, "validation_error", "quote_expires_at too far");
      }

      if (expiresAt.getTime() <= now.getTime()) {
        throw new HttpError(400, "validation_error", "quote_expires_at must be in the future");
      }

      const updated = await request.server.db
        .updateTable("jobs")
        .set({
          status: JOB_STATUS.quoted,
          quote_amount_raw: body.quote_amount_raw,
          quote_invoice_address: body.quote_invoice_address,
          quote_expires_at: expiresAt
        })
        .where("job_id", "=", job.job_id as string)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new HttpError(500, "internal_error", "Failed to quote job");
      }

      reply.send({ job: serializeJob(updated) });
    }
  );

  app.post(
    "/v1/jobs/:id/accept",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const jobId = (request.params as JobParams).id;
      const job = await fetchJob(request.server, jobId);

      if (!job) {
        reply.code(404).send(errorResponse("not_found", "Job not found"));
        return;
      }

      if (job.buyer_pubkey !== request.auth.pubkey) {
        reply.code(403).send(errorResponse("forbidden", "Not allowed"));
        return;
      }

      const refreshed = await maybeExpireJob(request.server, job as Record<string, unknown>);
      if (refreshed?.status === JOB_STATUS.expired) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job has expired"));
        return;
      }

      if (refreshed?.status !== JOB_STATUS.quoted) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job is not quoted"));
        return;
      }

      const updated = await request.server.db
        .updateTable("jobs")
        .set({ status: JOB_STATUS.accepted })
        .where("job_id", "=", job.job_id as string)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new HttpError(500, "internal_error", "Failed to accept job");
      }

      reply.send({ job: serializeJob(updated) });
    }
  );

  app.post(
    "/v1/jobs/:id/payment",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const body = paymentSchema.parse(request.body ?? {});
      const jobId = (request.params as JobParams).id;
      const job = await fetchJob(request.server, jobId);

      if (!job) {
        reply.code(404).send(errorResponse("not_found", "Job not found"));
        return;
      }

      if (job.buyer_pubkey !== request.auth.pubkey) {
        reply.code(403).send(errorResponse("forbidden", "Not allowed"));
        return;
      }

      const refreshed = await maybeExpireJob(request.server, job as Record<string, unknown>);
      if (refreshed?.status === JOB_STATUS.expired) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job has expired"));
        return;
      }

      if (refreshed?.status !== JOB_STATUS.accepted) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job is not accepted"));
        return;
      }

      const updated = await request.server.db
        .updateTable("jobs")
        .set({ payment_tx_hash: body.payment_tx_hash })
        .where("job_id", "=", job.job_id as string)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new HttpError(500, "internal_error", "Failed to attach payment");
      }

      reply.send({ job: serializeJob(updated) });
    }
  );

  app.post(
    "/v1/jobs/:id/lock",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const jobId = (request.params as JobParams).id;
      const job = await fetchJob(request.server, jobId);

      if (!job) {
        reply.code(404).send(errorResponse("not_found", "Job not found"));
        return;
      }

      if (job.seller_pubkey !== request.auth.pubkey) {
        reply.code(403).send(errorResponse("forbidden", "Not allowed"));
        return;
      }

      const refreshed = await maybeExpireJob(request.server, job as Record<string, unknown>);
      if (refreshed?.status === JOB_STATUS.expired) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job has expired"));
        return;
      }

      if (
        refreshed?.status !== JOB_STATUS.accepted &&
        refreshed?.status !== JOB_STATUS.running
      ) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job is not accepted"));
        return;
      }

      if (!refreshed?.payment_tx_hash) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Payment not submitted"));
        return;
      }

      const now = nowUtc();
      const lockExpiresAt = parseDate(refreshed.lock_expires_at as string | Date | null);
      if (
        refreshed.lock_owner &&
        lockExpiresAt &&
        lockExpiresAt.getTime() > now.getTime() &&
        refreshed.lock_owner !== request.auth.pubkey
      ) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Lock already held"));
        return;
      }

      const updated = await request.server.db
        .updateTable("jobs")
        .set({
          status: JOB_STATUS.running,
          lock_owner: request.auth.pubkey,
          lock_expires_at: secondsFromNow(LIMITS.lockTtlSeconds)
        })
        .where("job_id", "=", job.job_id as string)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new HttpError(500, "internal_error", "Failed to lock job");
      }

      reply.send({ job: serializeJob(updated) });
    }
  );

  app.post(
    "/v1/jobs/:id/deliver",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const body = deliverSchema.parse(request.body ?? {});
      if (body.result_payload != null) {
        enforceJsonSize(body.result_payload, LIMITS.resultPayloadMaxBytes, "result_payload");
      }
      if (body.error != null) {
        enforceJsonSize(body.error, LIMITS.errorPayloadMaxBytes, "error");
      }

      const jobId = (request.params as JobParams).id;
      const job = await fetchJob(request.server, jobId);

      if (!job) {
        reply.code(404).send(errorResponse("not_found", "Job not found"));
        return;
      }

      if (job.seller_pubkey !== request.auth.pubkey) {
        reply.code(403).send(errorResponse("forbidden", "Not allowed"));
        return;
      }

      const refreshed = await maybeExpireJob(request.server, job as Record<string, unknown>);
      if (refreshed?.status !== JOB_STATUS.running) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job is not running"));
        return;
      }

      const updated = await request.server.db
        .updateTable("jobs")
        .set({
          status: body.result_payload ? JOB_STATUS.delivered : JOB_STATUS.failed,
          result_payload: body.result_payload ?? null,
          error: body.error ?? null
        })
        .where("job_id", "=", job.job_id as string)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new HttpError(500, "internal_error", "Failed to deliver");
      }

      reply.send({ job: serializeJob(updated) });
    }
  );

  app.get(
    "/v1/jobs/:id",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const jobId = (request.params as JobParams).id;
      const job = await fetchJob(request.server, jobId);

      if (!job) {
        reply.code(404).send(errorResponse("not_found", "Job not found"));
        return;
      }

      try {
        ensureAuthorized(job as Record<string, unknown>, request.auth.pubkey);
      } catch (err) {
        if (err instanceof HttpError) {
          reply.code(err.statusCode).send(errorResponse(err.code, err.message));
          return;
        }
        throw err;
      }

      const refreshed = await maybeExpireJob(request.server, job as Record<string, unknown>);
      reply.send({ job: serializeJob((refreshed ?? job) as Record<string, unknown>) });
    }
  );

  app.post(
    "/v1/jobs/:id/cancel",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      cancelSchema.parse(request.body ?? {});
      const jobId = (request.params as JobParams).id;
      const job = await fetchJob(request.server, jobId);

      if (!job) {
        reply.code(404).send(errorResponse("not_found", "Job not found"));
        return;
      }

      if (job.buyer_pubkey !== request.auth.pubkey) {
        reply.code(403).send(errorResponse("forbidden", "Not allowed"));
        return;
      }

      const refreshed = await maybeExpireJob(request.server, job as Record<string, unknown>);
      if (refreshed?.status === JOB_STATUS.expired) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job has expired"));
        return;
      }

      if (
        refreshed?.status !== JOB_STATUS.requested &&
        refreshed?.status !== JOB_STATUS.quoted &&
        refreshed?.status !== JOB_STATUS.accepted
      ) {
        reply
          .code(409)
          .send(errorResponse("invalid_state", "Job cannot be canceled"));
        return;
      }

      const updated = await request.server.db
        .updateTable("jobs")
        .set({ status: JOB_STATUS.canceled })
        .where("job_id", "=", job.job_id as string)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new HttpError(500, "internal_error", "Failed to cancel job");
      }

      reply.send({ job: serializeJob(updated) });
    }
  );

};
