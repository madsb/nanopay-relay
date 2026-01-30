#!/usr/bin/env node
import {
  createCharge,
  createPaymentProcessor,
  nanoToRaw,
  rawToNano,
  setChargeMapping
} from '../../nanorelay-common/berrypay.mjs';
import { parseArgs, parseNumber } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
const amountRaw = args['amount-raw'];
const amountNano = args['amount-nano'];
const qrOutput = args['qr-output'];
const timeoutMs = parseNumber(args['timeout-ms']);

if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}
if (amountRaw && amountNano) {
  console.error('Provide only one of --amount-raw or --amount-nano');
  process.exit(1);
}
if (!amountRaw && !amountNano) {
  console.error('Missing --amount-raw or --amount-nano');
  process.exit(1);
}
if (qrOutput === true) {
  console.error('Missing --qr-output <path>');
  process.exit(1);
}

const resolvedAmountNano = amountNano
  ? String(amountNano)
  : rawToNano(String(amountRaw));
const resolvedAmountRaw = amountRaw
  ? String(amountRaw)
  : nanoToRaw(String(amountNano));

const processor = createPaymentProcessor({ autoSweep: true });
await processor.start();
const charge = await createCharge(processor, {
  amountNano: resolvedAmountNano,
  metadata: { job_id: jobId },
  qrOutput: typeof qrOutput === 'string' ? qrOutput : undefined,
  timeoutMs: timeoutMs
});
await setChargeMapping(jobId, charge.chargeId);
processor.stop();

const result = {
  job_id: jobId,
  charge_id: charge.chargeId,
  address: charge.address,
  amount_nano: charge.amount_nano ?? resolvedAmountNano,
  amount_raw: charge.amount_raw ?? resolvedAmountRaw
};
if (charge.qr_path) {
  result.qr_path = charge.qr_path;
}

console.log(JSON.stringify(result, null, 2));
