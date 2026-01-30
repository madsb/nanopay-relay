#!/usr/bin/env node
import { createClient, parseArgs, readJsonArg, printResult } from './utils.mjs';

const args = parseArgs();
const jobId = args['job-id'];
if (!jobId || typeof jobId !== 'string') {
  console.error('Missing --job-id');
  process.exit(1);
}

const resultUrl = typeof args['result-url'] === 'string' ? args['result-url'] : undefined;
const errorPayload = await readJsonArg({
  jsonValue: args.error,
  filePath: args['error-file']
});

const hasResult = resultUrl !== undefined && resultUrl !== null;
const hasError = errorPayload !== undefined && errorPayload !== null;

if (hasResult === hasError) {
  console.error('Provide exactly one of --result-url or --error/--error-file');
  process.exit(1);
}

const client = createClient();
const result = await client.deliverJob(jobId, {
  result_url: hasResult ? resultUrl : null,
  error: hasError ? errorPayload : null
});
printResult(result);
