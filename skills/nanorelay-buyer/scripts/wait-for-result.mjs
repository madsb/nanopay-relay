#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';
import {
  createClient,
  parseArgs,
  parseNumber
} from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}

const timeoutMs =
  parseNumber(args['timeout-ms']) ??
  parseNumber(process.env.PAYMENT_TIMEOUT_MS) ??
  30 * 60 * 1000;
const pollIntervalMs =
  parseNumber(args['poll-interval-ms']) ??
  parseNumber(process.env.POLL_INTERVAL_MS) ??
  2000;

const client = createClient();
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  const result = await client.getJob(jobId);
  if (!result.ok) {
    console.error(JSON.stringify(result.error, null, 2));
    process.exit(1);
  }
  const job = result.data.job;
  if (job.status === 'delivered') {
    console.log(
      JSON.stringify(
        { status: job.status, result_url: job.result_url },
        null,
        2
      )
    );
    process.exit(0);
  }
  if (job.status === 'failed') {
    console.log(
      JSON.stringify({ status: job.status, error: job.error }, null, 2)
    );
    process.exit(1);
  }
  if (['canceled', 'expired'].includes(job.status)) {
    console.error(
      JSON.stringify({ status: job.status, error: job.error }, null, 2)
    );
    process.exit(1);
  }
  await delay(pollIntervalMs);
}

console.error(JSON.stringify({ status: 'timeout', error: 'Timeout waiting for job result' }, null, 2));
process.exit(1);
