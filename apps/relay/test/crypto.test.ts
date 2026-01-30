import { describe, expect, it } from 'vitest';
import { signCanonical, verifyCanonical } from '@nanobazaar/shared';
import { createKeypair } from './helpers.js';

describe('canonical signing', () => {
  it('signs and verifies canonical payloads', () => {
    const keypair = createKeypair();
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = signCanonical({
      method: 'POST',
      path: '/v1/offers',
      timestamp: '1234567890',
      nonce: 'aabbccddeeff00112233445566778899',
      body,
      privateKeyHex: keypair.privateKey
    });

    const ok = verifyCanonical({
      method: 'POST',
      path: '/v1/offers',
      timestamp: '1234567890',
      nonce: 'aabbccddeeff00112233445566778899',
      body,
      publicKeyHex: keypair.publicKey,
      signatureHex: signature
    });

    expect(ok).toBe(true);
  });

  it('rejects tampered payloads', () => {
    const keypair = createKeypair();
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = signCanonical({
      method: 'POST',
      path: '/v1/offers',
      timestamp: '1234567890',
      nonce: 'aabbccddeeff00112233445566778899',
      body,
      privateKeyHex: keypair.privateKey
    });
    const tampered = Buffer.from(JSON.stringify({ hello: 'moon' }));

    const ok = verifyCanonical({
      method: 'POST',
      path: '/v1/offers',
      timestamp: '1234567890',
      nonce: 'aabbccddeeff00112233445566778899',
      body: tampered,
      publicKeyHex: keypair.publicKey,
      signatureHex: signature
    });

    expect(ok).toBe(false);
  });
});
