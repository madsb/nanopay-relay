#!/usr/bin/env node
import {
  createPaymentProcessor,
  getChargeMapping,
  getChargeStatus
} from '../../nanorelay-common/berrypay.mjs';
import { parseArgs } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
let chargeId = args['charge-id'];

if (!jobId && !chargeId) {
  console.error('Provide --job-id or --charge-id');
  process.exit(1);
}

if (!chargeId && typeof jobId === 'string') {
  const mapped = await getChargeMapping(jobId);
  if (!mapped) {
    console.error(`No charge mapping found for job ${jobId}`);
    process.exit(1);
  }
  chargeId = mapped;
}

if (!chargeId || typeof chargeId !== 'string') {
  console.error('Missing --charge-id');
  process.exit(1);
}

const processor = createPaymentProcessor({ autoSweep: true });
const status = await getChargeStatus(processor, chargeId);

const result = {
  job_id: typeof jobId === 'string' ? jobId : undefined,
  charge_id: chargeId,
  ...status
};

console.log(JSON.stringify(result, null, 2));
