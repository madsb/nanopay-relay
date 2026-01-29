import nacl from 'tweetnacl';
import { randomBytes } from 'node:crypto';
import { bytesToHex, signCanonical } from '@nanopay/shared';
import type { FastifyInstance } from 'fastify';

export type KeypairHex = {
  publicKey: string;
  privateKey: string;
};

export const createKeypair = (): KeypairHex => {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: bytesToHex(kp.publicKey),
    privateKey: bytesToHex(kp.secretKey)
  };
};

export const authHeaders = ({
  method,
  path,
  body,
  keypair,
  nonce,
  timestamp
}: {
  method: string;
  path: string;
  body: Buffer;
  keypair: KeypairHex;
  nonce?: string;
  timestamp?: string;
}) => {
  const ts = timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonceValue = nonce ?? randomBytes(16).toString('hex');
  const signature = signCanonical({
    method,
    path,
    timestamp: ts,
    nonce: nonceValue,
    body,
    privateKeyHex: keypair.privateKey
  });

  return {
    'x-molt-pubkey': keypair.publicKey,
    'x-molt-timestamp': ts,
    'x-molt-nonce': nonceValue,
    'x-molt-signature': signature
  };
};

export const truncateAll = async (server: FastifyInstance) => {
  await server.db.deleteFrom('nonces').execute();
  await server.db.deleteFrom('jobs').execute();
  await server.db.deleteFrom('offers').execute();
};
