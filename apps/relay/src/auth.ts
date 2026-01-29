import { createHash } from 'crypto';
import nacl from 'tweetnacl';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from './db';
import { authError } from './http';
import { LIMITS } from './limits';

const HEX_LOWER_REGEX = /^[0-9a-f]+$/;

const sha256Hex = (input: Uint8Array | Buffer | string) =>
  createHash('sha256').update(input).digest('hex');

const toBuffer = (value: unknown) => {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.alloc(0);
};

const hexToBytes = (value: string) => {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return bytes;
};

export const canonicalString = (request: FastifyRequest, bodyHashHex: string, timestamp: string, nonce: string) => {
  const method = request.method.toUpperCase();
  const pathWithQuery = request.raw.url ?? request.url;
  return `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${bodyHashHex}`;
};

const isLowerHex = (value: string, length?: number) => {
  if (!HEX_LOWER_REGEX.test(value)) return false;
  if (length !== undefined && value.length !== length) return false;
  return value === value.toLowerCase();
};

const nonceLengthValid = (value: string) => value.length >= 32 && value.length <= 64 && value.length % 2 === 0;

const consumeNonce = async (db: Kysely<Database>, pubkey: string, nonce: string, now = new Date()) => {
  const nonceHash = sha256Hex(nonce);
  const expiresAt = new Date(now.getTime() + LIMITS.nonceTtlMs);
  await db.deleteFrom('auth_nonces').where('expires_at', '<', now).execute();
  try {
    await db
      .insertInto('auth_nonces')
      .values({ pubkey, nonce_hash: nonceHash, expires_at: expiresAt })
      .execute();
    return true;
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError?.code === '23505') {
      return false;
    }
    throw error;
  }
};

export const createAuthGuard = (db: Kysely<Database>, now = () => new Date()) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const pubkey = request.headers['x-molt-pubkey'];
    const timestamp = request.headers['x-molt-timestamp'];
    const nonce = request.headers['x-molt-nonce'];
    const signature = request.headers['x-molt-signature'];

    if (
      typeof pubkey !== 'string' ||
      typeof timestamp !== 'string' ||
      typeof nonce !== 'string' ||
      typeof signature !== 'string'
    ) {
      return authError(reply, 'auth.invalid_signature', 'Missing authentication headers');
    }

    if (!isLowerHex(pubkey, 64) || !isLowerHex(signature, 128) || !isLowerHex(nonce) || !nonceLengthValid(nonce)) {
      return authError(reply, 'auth.invalid_signature', 'Invalid authentication headers');
    }

    const timestampNumber = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(timestampNumber)) {
      return authError(reply, 'auth.timestamp_skew', 'Invalid timestamp');
    }

    const nowValue = now();
    const skew = Math.abs(nowValue.getTime() / 1000 - timestampNumber);
    if (skew > LIMITS.authSkewSeconds) {
      return authError(reply, 'auth.timestamp_skew', 'Timestamp out of range');
    }

    const bodyBuffer = toBuffer((request as { rawBody?: Buffer }).rawBody);
    const bodyHashHex = sha256Hex(bodyBuffer);
    const canonical = canonicalString(request, bodyHashHex, timestamp, nonce);
    const message = Buffer.from(canonical, 'utf8');

    const verified = nacl.sign.detached.verify(
      message,
      hexToBytes(signature),
      hexToBytes(pubkey)
    );

    if (!verified) {
      return authError(reply, 'auth.invalid_signature', 'Signature verification failed');
    }

    const nonceAccepted = await consumeNonce(db, pubkey, nonce, nowValue);
    if (!nonceAccepted) {
      return authError(reply, 'auth.nonce_replay', 'Nonce has already been used');
    }

    (request as { molt?: { pubkey: string } }).molt = { pubkey };
  };
};
