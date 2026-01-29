import { createHash } from "node:crypto";
import nacl from "tweetnacl";

export type CanonicalInput = {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  nonce: string;
  body: Uint8Array;
};

export const sha256Hex = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

export const bytesToHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

export const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, "hex"));

export const buildCanonicalString = ({
  method,
  pathWithQuery,
  timestamp,
  nonce,
  body
}: CanonicalInput): string => {
  return `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${sha256Hex(body)}`;
};

export const signDetachedHex = (message: string, secretKeyHex: string): string => {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, hexToBytes(secretKeyHex));
  return bytesToHex(signature);
};

export const verifyDetachedHex = (
  message: string,
  signatureHex: string,
  publicKeyHex: string
): boolean => {
  const messageBytes = new TextEncoder().encode(message);
  return nacl.sign.detached.verify(
    messageBytes,
    hexToBytes(signatureHex),
    hexToBytes(publicKeyHex)
  );
};

export const generateKeypair = () => {
  const pair = nacl.sign.keyPair();
  return {
    publicKey: bytesToHex(pair.publicKey),
    secretKey: bytesToHex(pair.secretKey)
  };
};
