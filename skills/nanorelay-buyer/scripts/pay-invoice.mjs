#!/usr/bin/env node
import {
  ensureWallet,
  receivePending,
  sendRaw
} from './berrypay.mjs';
import {
  createClient,
  parseArgs,
  parseBool
} from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
const skipSubmit = parseBool(args['skip-submit']) ?? false;

if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}

const client = createClient();
const jobResult = await client.getJob(jobId);
if (!jobResult.ok) {
  console.error(JSON.stringify(jobResult.error, null, 2));
  process.exit(1);
}

const job = jobResult.data.job;
const address = job?.quote_invoice_address;
const amountRaw = job?.quote_amount_raw;

if (!address || typeof address !== 'string') {
  console.error('Job is missing quote_invoice_address');
  process.exit(1);
}
if (!amountRaw || typeof amountRaw !== 'string') {
  console.error('Job is missing quote_amount_raw');
  process.exit(1);
}

const { wallet } = ensureWallet();
await receivePending(wallet);
const { txHash } = await sendRaw(wallet, address, amountRaw);

let updatedJob = job;
if (!skipSubmit) {
  const submitResult = await client.submitPayment(jobId, {
    payment_tx_hash: txHash
  });
  if (!submitResult.ok) {
    console.error(JSON.stringify(submitResult.error, null, 2));
    process.exit(1);
  }
  updatedJob = submitResult.data.job ?? updatedJob;
}

const result = {
  job_id: jobId,
  payment_tx_hash: txHash,
  amount_raw: amountRaw,
  address,
  job: updatedJob
};

console.log(JSON.stringify(result, null, 2));
