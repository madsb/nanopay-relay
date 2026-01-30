#!/usr/bin/env node
import {
  createCharge,
  createPaymentProcessor,
  nanoToRaw,
  rawToNano,
  setChargeMapping
} from '../../nanorelay-common/berrypay.mjs';
import { createClient, parseArgs, parseNumber, printResult } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
const quoteAmountRaw = args['quote-amount-raw'];
const quoteAmountNano = args['quote-amount-nano'];
const quoteExpiresAt = args['quote-expires-at'];
const timeoutMs = parseNumber(args['timeout-ms']);
const qrOutput = args['qr-output'];

if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}
if (quoteAmountRaw && quoteAmountNano) {
  console.error('Provide only one of --quote-amount-raw or --quote-amount-nano');
  process.exit(1);
}
if (!quoteAmountRaw && !quoteAmountNano) {
  console.error('Missing --quote-amount-raw or --quote-amount-nano');
  process.exit(1);
}
if (qrOutput === true) {
  console.error('Missing --qr-output <path>');
  process.exit(1);
}

const resolvedAmountNano = quoteAmountNano
  ? String(quoteAmountNano)
  : rawToNano(String(quoteAmountRaw));
const resolvedAmountRaw = quoteAmountRaw
  ? String(quoteAmountRaw)
  : nanoToRaw(String(quoteAmountNano));

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

const client = createClient();
const result = await client.quoteJob(jobId, {
  quote_amount_raw: resolvedAmountRaw,
  quote_invoice_address: charge.address,
  quote_expires_at:
    typeof quoteExpiresAt === 'string' ? quoteExpiresAt : undefined
});

if (!result.ok) {
  console.error(JSON.stringify(result.error, null, 2));
  process.exit(1);
}

const payload = {
  job: result.data.job,
  charge: {
    charge_id: charge.chargeId,
    address: charge.address,
    amount_nano: charge.amount_nano ?? resolvedAmountNano,
    amount_raw: charge.amount_raw ?? resolvedAmountRaw,
    qr_path: charge.qr_path
  }
};

printResult({ ok: true, data: payload });
