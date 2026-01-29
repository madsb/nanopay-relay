#!/usr/bin/env node
import { createClient, parseArgs, printResult } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}

const client = createClient();
const result = await client.lockJob(jobId);
printResult(result);
