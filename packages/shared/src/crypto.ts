import nacl from 'tweetnacl';
import { createHash } from 'node:crypto';

export type CanonicalInput = {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: Uint8Array;
};

const textEncoder = new TextEncoder();

export const bytesToHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('hex');

export const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
};

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const canonicalString = (input: CanonicalInput): string => {
  const method = input.method.toUpperCase();
  return [
    method,
    input.path,
    input.timestamp,
    input.nonce,
    sha256Hex(input.body)
  ].join('\n');
};

export const signCanonical = (
  input: CanonicalInput & { privateKeyHex: string }
): string => {
  const message = textEncoder.encode(canonicalString(input));
  const secretKey = hexToBytes(input.privateKeyHex);
  const signature = nacl.sign.detached(message, secretKey);
  return bytesToHex(signature);
};

export const verifyCanonical = (
  input: CanonicalInput & { publicKeyHex: string; signatureHex: string }
): boolean => {
  const message = textEncoder.encode(canonicalString(input));
  const publicKey = hexToBytes(input.publicKeyHex);
  const signature = hexToBytes(input.signatureHex);
  return nacl.sign.detached.verify(message, signature, publicKey);
};
