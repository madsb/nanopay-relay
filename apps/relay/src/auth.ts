import type { FastifyReply, FastifyRequest } from "fastify";
import { buildCanonicalString, sha256Hex, verifyDetachedHex } from "@nanopay/shared";
import { HEADER_NAMES, LIMITS } from "./constants.js";
import { errorResponse } from "./errors.js";

const hexRegex = /^[0-9a-f]+$/;

const isHexLength = (value: string, min: number, max: number) => {
  if (value.length < min || value.length > max) return false;
  return hexRegex.test(value);
};

export const requireAuth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const pubkey = request.headers[HEADER_NAMES.pubkey] as string | undefined;
  const timestamp = request.headers[HEADER_NAMES.timestamp] as string | undefined;
  const nonce = request.headers[HEADER_NAMES.nonce] as string | undefined;
  const signature = request.headers[HEADER_NAMES.signature] as string | undefined;

  if (!pubkey || !timestamp || !nonce || !signature) {
    reply
      .code(401)
      .send(errorResponse("auth.invalid_signature", "Missing auth headers"));
    return;
  }

  if (!isHexLength(pubkey, 64, 64) || !isHexLength(signature, 128, 128)) {
    reply
      .code(401)
      .send(errorResponse("auth.invalid_signature", "Invalid signature"));
    return;
  }

  if (!isHexLength(nonce, 32, 64)) {
    reply
      .code(401)
      .send(errorResponse("auth.invalid_signature", "Invalid nonce"));
    return;
  }

  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) {
    reply
      .code(401)
      .send(errorResponse("auth.invalid_signature", "Invalid timestamp"));
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > LIMITS.authSkewSeconds) {
    reply
      .code(401)
      .send(errorResponse("auth.timestamp_skew", "Timestamp out of range"));
    return;
  }

  const rawBody = request.rawBody ?? Buffer.alloc(0);
  const pathWithQuery = request.raw.url ?? request.url;
  const canonical = buildCanonicalString({
    method: request.method,
    pathWithQuery,
    timestamp,
    nonce,
    body: rawBody
  });

  const valid = verifyDetachedHex(canonical, signature, pubkey);
  if (!valid) {
    reply
      .code(401)
      .send(errorResponse("auth.invalid_signature", "Invalid signature"));
    return;
  }

  const nonceHash = sha256Hex(Buffer.from(nonce, "utf8"));
  const cutoff = new Date(Date.now() - LIMITS.nonceTtlSeconds * 1000);

  try {
    await request.server.db
      .deleteFrom("auth_nonces")
      .where("created_at", "<", cutoff)
      .execute();

    await request.server.db
      .insertInto("auth_nonces")
      .values({
        pubkey,
        nonce_hash: nonceHash,
        created_at: new Date()
      })
      .execute();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      reply
        .code(401)
        .send(errorResponse("auth.nonce_replay", "Nonce already used"));
      return;
    }
    throw err;
  }

  request.auth = { pubkey };
};
