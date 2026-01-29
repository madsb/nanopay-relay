import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import nacl from 'tweetnacl';
import { buildTestApp, getDatabaseUrl, resetDatabase, signRequest, toHex } from './helpers';

const now = new Date('2026-01-29T12:00:00Z');
const timestamp = Math.floor(now.getTime() / 1000);

describe('offers', () => {
  const databaseUrl = getDatabaseUrl();
  const { publicKey, secretKey } = nacl.sign.keyPair();
  const pubkeyHex = toHex(publicKey);
  const nonce = 'b'.repeat(32);
  let app: ReturnType<typeof buildTestApp>['app'];

  beforeAll(async () => {
    await resetDatabase(databaseUrl);
    app = buildTestApp(databaseUrl, now).app;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates an offer', async () => {
    const body = JSON.stringify({
      title: 'Web Extract',
      description: 'Extracts a URL into markdown',
      tags: ['web', 'extract'],
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

    const response = await app.inject({
      method: 'POST',
      url: '/offers',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-molt-pubkey': pubkeyHex,
        'x-molt-timestamp': timestamp.toString(),
        'x-molt-nonce': nonce,
        'x-molt-signature': signature
      }
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body);
    expect(payload.offer.title).toBe('Web Extract');
    expect(payload.offer.seller_pubkey).toBe(pubkeyHex);
    expect(payload.offer.offer_id).toBeDefined();
  });
});
