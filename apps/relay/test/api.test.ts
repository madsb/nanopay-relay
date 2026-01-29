import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { authHeaders, createKeypair, truncateAll } from './helpers.js';

const json = (value: unknown) => JSON.stringify(value);

describe('relay api', () => {
  const seller = createKeypair();
  const buyer = createKeypair();
  let server: Awaited<ReturnType<typeof buildServer>>;

  const signedInject = async ({
    method,
    url,
    body,
    keypair,
    nonce,
    timestamp
  }: {
    method: string;
    url: string;
    body?: unknown;
    keypair: ReturnType<typeof createKeypair>;
    nonce?: string;
    timestamp?: string;
  }) => {
    const payload = body === undefined ? undefined : json(body);
    const rawBody = payload ? Buffer.from(payload) : Buffer.alloc(0);
    const headers = authHeaders({
      method,
      path: url,
      body: rawBody,
      keypair,
      nonce,
      timestamp
    });

    if (payload) {
      headers['content-type'] = 'application/json';
    }

    return server.inject({
      method,
      url,
      payload,
      headers
    });
  };

  beforeAll(async () => {
    server = await buildServer(process.env.DATABASE_URL);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await truncateAll(server);
  });

  it('rejects missing auth and replays', async () => {
    const payload = {
      title: 'Web Extract',
      description: 'Extract web content',
      tags: ['web'],
      pricing_mode: 'fixed',
      fixed_price_raw: '1000',
      active: true
    };

    const missing = await server.inject({
      method: 'POST',
      url: '/v1/offers',
      payload: json(payload),
      headers: {
        'content-type': 'application/json'
      }
    });
    expect(missing.statusCode).toBe(401);

    const nonce = 'aabbccddeeff00112233445566778899';
    const first = await signedInject({
      method: 'POST',
      url: '/v1/offers',
      body: payload,
      keypair: seller,
      nonce
    });
    expect(first.statusCode).toBe(201);

    const replay = await signedInject({
      method: 'POST',
      url: '/v1/offers',
      body: payload,
      keypair: seller,
      nonce
    });
    expect(replay.statusCode).toBe(401);
    expect(JSON.parse(replay.body).error.code).toBe('auth.nonce_replay');
  });

  it('runs the core job lifecycle', async () => {
    const offerPayload = {
      title: 'Web Extract',
      description: 'Extract web content',
      tags: ['web'],
      pricing_mode: 'fixed',
      fixed_price_raw: '1000',
      active: true
    };

    const offerRes = await signedInject({
      method: 'POST',
      url: '/v1/offers',
      body: offerPayload,
      keypair: seller
    });
    expect(offerRes.statusCode).toBe(201);
    const offer = JSON.parse(offerRes.body).offer;

    const jobRes = await signedInject({
      method: 'POST',
      url: '/v1/jobs',
      body: {
        offer_id: offer.offer_id,
        request_payload: { url: 'https://example.com' }
      },
      keypair: buyer
    });
    expect(jobRes.statusCode).toBe(201);
    const job = JSON.parse(jobRes.body).job;

    const quoteRes = await signedInject({
      method: 'POST',
      url: `/v1/jobs/${job.job_id}/quote`,
      body: {
        quote_amount_raw: '2500',
        quote_invoice_address: 'nano_1exampleaddress',
        quote_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      },
      keypair: seller
    });
    expect(quoteRes.statusCode).toBe(200);
    expect(JSON.parse(quoteRes.body).job.status).toBe('quoted');

    const acceptRes = await signedInject({
      method: 'POST',
      url: `/v1/jobs/${job.job_id}/accept`,
      body: {},
      keypair: buyer
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(JSON.parse(acceptRes.body).job.status).toBe('accepted');

    const paymentRes = await signedInject({
      method: 'POST',
      url: `/v1/jobs/${job.job_id}/payment`,
      body: { payment_tx_hash: 'ABC123' },
      keypair: buyer
    });
    expect(paymentRes.statusCode).toBe(200);

    const lockRes = await signedInject({
      method: 'POST',
      url: `/v1/jobs/${job.job_id}/lock`,
      body: {},
      keypair: seller
    });
    expect(lockRes.statusCode).toBe(200);
    expect(JSON.parse(lockRes.body).job.status).toBe('running');

    const deliverRes = await signedInject({
      method: 'POST',
      url: `/v1/jobs/${job.job_id}/deliver`,
      body: {
        result_payload: { markdown: '# Hello' },
        error: null
      },
      keypair: seller
    });
    expect(deliverRes.statusCode).toBe(200);
    expect(JSON.parse(deliverRes.body).job.status).toBe('delivered');

    const getRes = await signedInject({
      method: 'GET',
      url: `/v1/jobs/${job.job_id}`,
      keypair: buyer
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body).job.result_payload).toEqual({
      markdown: '# Hello'
    });
  });

  it('enforces request_payload size limits', async () => {
    const offerPayload = {
      title: 'Big payload',
      description: 'Payload cap check',
      tags: ['limits'],
      pricing_mode: 'fixed',
      fixed_price_raw: '1000',
      active: true
    };
    const offerRes = await signedInject({
      method: 'POST',
      url: '/v1/offers',
      body: offerPayload,
      keypair: seller
    });
    const offer = JSON.parse(offerRes.body).offer;

    const big = 'a'.repeat(70 * 1024);
    const jobRes = await signedInject({
      method: 'POST',
      url: '/v1/jobs',
      body: {
        offer_id: offer.offer_id,
        request_payload: { text: big }
      },
      keypair: buyer
    });
    expect(jobRes.statusCode).toBe(413);
    expect(JSON.parse(jobRes.body).error.code).toBe('payload_too_large');
  });

  it('filters jobs by updated_after', async () => {
    const offerPayload = {
      title: 'Updated After',
      description: 'Cursor filtering',
      tags: ['cursor'],
      pricing_mode: 'fixed',
      fixed_price_raw: '1000',
      active: true
    };
    const offerRes = await signedInject({
      method: 'POST',
      url: '/v1/offers',
      body: offerPayload,
      keypair: seller
    });
    expect(offerRes.statusCode).toBe(201);
    const offer = JSON.parse(offerRes.body).offer;

    const jobRes1 = await signedInject({
      method: 'POST',
      url: '/v1/jobs',
      body: {
        offer_id: offer.offer_id,
        request_payload: { url: 'https://example.com/1' }
      },
      keypair: buyer
    });
    expect(jobRes1.statusCode).toBe(201);
    const job1 = JSON.parse(jobRes1.body).job;

    await new Promise((resolve) => setTimeout(resolve, 5));

    const jobRes2 = await signedInject({
      method: 'POST',
      url: '/v1/jobs',
      body: {
        offer_id: offer.offer_id,
        request_payload: { url: 'https://example.com/2' }
      },
      keypair: buyer
    });
    expect(jobRes2.statusCode).toBe(201);
    const job2 = JSON.parse(jobRes2.body).job;

    const updatedAfter = new Date(job1.updated_at);
    updatedAfter.setMilliseconds(updatedAfter.getMilliseconds() + 1);

    const listRes = await signedInject({
      method: 'GET',
      url: `/v1/jobs?role=buyer&updated_after=${encodeURIComponent(
        updatedAfter.toISOString()
      )}`,
      keypair: buyer
    });
    expect(listRes.statusCode).toBe(200);
    const jobs = JSON.parse(listRes.body).jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].job_id).toBe(job2.job_id);
  });

  it('validates updated_after in job listing', async () => {
    const listRes = await signedInject({
      method: 'GET',
      url: '/v1/jobs?role=buyer&updated_after=not-a-date',
      keypair: buyer
    });
    expect(listRes.statusCode).toBe(400);
    expect(JSON.parse(listRes.body).error.code).toBe('validation_error');
  });

  it('orders jobs by updated_at when updated_after is set', async () => {
    const offerPayload = {
      title: 'Order by updated_at',
      description: 'Ordering check',
      tags: ['order'],
      pricing_mode: 'fixed',
      fixed_price_raw: '1000',
      active: true
    };
    const offerRes = await signedInject({
      method: 'POST',
      url: '/v1/offers',
      body: offerPayload,
      keypair: seller
    });
    expect(offerRes.statusCode).toBe(201);
    const offer = JSON.parse(offerRes.body).offer;

    const jobRes1 = await signedInject({
      method: 'POST',
      url: '/v1/jobs',
      body: {
        offer_id: offer.offer_id,
        request_payload: { url: 'https://example.com/1' }
      },
      keypair: buyer
    });
    expect(jobRes1.statusCode).toBe(201);
    const job1 = JSON.parse(jobRes1.body).job;

    await new Promise((resolve) => setTimeout(resolve, 10));

    const jobRes2 = await signedInject({
      method: 'POST',
      url: '/v1/jobs',
      body: {
        offer_id: offer.offer_id,
        request_payload: { url: 'https://example.com/2' }
      },
      keypair: buyer
    });
    expect(jobRes2.statusCode).toBe(201);
    const job2 = JSON.parse(jobRes2.body).job;

    await new Promise((resolve) => setTimeout(resolve, 10));

    const quoteRes = await signedInject({
      method: 'POST',
      url: `/v1/jobs/${job1.job_id}/quote`,
      body: {
        quote_amount_raw: '2500',
        quote_invoice_address: 'nano_1exampleaddress',
        quote_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      },
      keypair: seller
    });
    expect(quoteRes.statusCode).toBe(200);

    const listRes = await signedInject({
      method: 'GET',
      url: '/v1/jobs?role=seller&updated_after=1970-01-01T00:00:00Z',
      keypair: seller
    });
    expect(listRes.statusCode).toBe(200);
    const jobs = JSON.parse(listRes.body).jobs;
    expect(jobs).toHaveLength(2);
    expect(jobs[0].job_id).toBe(job2.job_id);
    expect(jobs[1].job_id).toBe(job1.job_id);
  });
});
