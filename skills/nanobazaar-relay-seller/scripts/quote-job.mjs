#!/usr/bin/env node
import { createClient, parseArgs, printResult } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
const quoteAmountRaw = args['quote-amount-raw'];
const quoteInvoiceAddress = args['quote-invoice-address'];

if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}
if (!quoteAmountRaw || typeof quoteAmountRaw !== 'string') {
  console.error('Missing --quote-amount-raw');
  process.exit(1);
}
if (!quoteInvoiceAddress || typeof quoteInvoiceAddress !== 'string') {
  console.error('Missing --quote-invoice-address');
  process.exit(1);
}

const client = createClient();
const result = await client.quoteJob(jobId, {
  quote_amount_raw: quoteAmountRaw,
  quote_invoice_address: quoteInvoiceAddress,
  quote_expires_at:
    typeof args['quote-expires-at'] === 'string'
      ? args['quote-expires-at']
      : undefined
});
printResult(result);
