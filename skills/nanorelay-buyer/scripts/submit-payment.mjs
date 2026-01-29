#!/usr/bin/env node
import { createClient, parseArgs, printResult } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
const paymentTxHash = args['payment-tx-hash'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}
if (!paymentTxHash || typeof paymentTxHash !== 'string') {
  console.error('Missing --payment-tx-hash');
  process.exit(1);
}

const client = createClient();
const result = await client.submitPayment(jobId, {
  payment_tx_hash: paymentTxHash
});
printResult(result);
