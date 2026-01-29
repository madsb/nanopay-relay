import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import nacl from 'tweetnacl';
import { buildTestApp, getDatabaseUrl, resetDatabase, signRequest, toHex } from './helpers';

const now = new Date('2026-01-29T12:00:00Z');
const timestamp = Math.floor(now.getTime() / 1000);

describe('auth signature verification', () => {
  const databaseUrl = getDatabaseUrl();
  const { publicKey, secretKey } = nacl.sign.keyPair();
  const pubkeyHex = toHex(publicKey);
  const nonce = 'a'.repeat(32);
  let app: ReturnType<typeof buildTestApp>['app'];

  beforeAll(async () => {
    await resetDatabase(databaseUrl);
    app = buildTestApp(databaseUrl, now).app;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects invalid signatures', async () => {
    const body = JSON.stringify({
      title: 'Bad Offer',
      description: 'Should fail',
      tags: ['test'],
      pricing_mode: 'fixed',
      fixed_price_raw: '1000',
      active: true
    });

    const signature = signRequest({
      method: 'POST',
      path: '/offers',
      body,
      timestamp,
      nonce,
      secretKey
    });

    const badSignature = signature.slice(0, -1) + '0';

    const response = await app.inject({
      method: 'POST',
      url: '/offers',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-molt-pubkey': pubkeyHex,
        'x-molt-timestamp': timestamp.toString(),
        'x-molt-nonce': nonce,
        'x-molt-signature': badSignature
      }
    });

    expect(response.statusCode).toBe(401);
    const payload = JSON.parse(response.body);
    expect(payload.error.code).toBe('auth.invalid_signature');
  });
});
