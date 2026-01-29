import type { FastifyReply } from 'fastify';

export const sendError = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details: unknown = null
) => reply.status(status).send({ error: { code, message, details } });

export const validationError = (reply: FastifyReply, message: string, details?: unknown) =>
  sendError(reply, 400, 'validation_error', message, details ?? null);

export const invalidStateError = (reply: FastifyReply, message: string, details?: unknown) =>
  sendError(reply, 409, 'invalid_state', message, details ?? null);

export const notFoundError = (reply: FastifyReply, message = 'Not found') =>
  sendError(reply, 404, 'not_found', message, null);

export const forbiddenError = (reply: FastifyReply, message = 'Forbidden') =>
  sendError(reply, 403, 'forbidden', message, null);

export const payloadTooLargeError = (reply: FastifyReply, message = 'Payload too large') =>
  sendError(reply, 413, 'payload_too_large', message, null);

export const authError = (reply: FastifyReply, code: 'auth.invalid_signature' | 'auth.timestamp_skew' | 'auth.nonce_replay', message: string) =>
  sendError(reply, 401, code, message, null);
