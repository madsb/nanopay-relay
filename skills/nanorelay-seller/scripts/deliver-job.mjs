#!/usr/bin/env node
import { createClient, parseArgs, readJsonArg, printResult } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}

const resultPayload = await readJsonArg({
  jsonValue: args.result,
  filePath: args['result-file']
});
const errorPayload = await readJsonArg({
  jsonValue: args.error,
  filePath: args['error-file']
});

const hasResult = resultPayload !== undefined && resultPayload !== null;
const hasError = errorPayload !== undefined && errorPayload !== null;

if (hasResult === hasError) {
  console.error('Provide exactly one of --result/--result-file or --error/--error-file');
  process.exit(1);
}

const client = createClient();
const result = await client.deliverJob(jobId, {
  result_payload: hasResult ? resultPayload : null,
  error: hasError ? errorPayload : null
});
printResult(result);
