#!/usr/bin/env node
import {
  createClient,
  parseArgs,
  parseNumber,
  printResult
} from './utils.mjs';

const args = parseArgs();
const params = {
  status: typeof args.status === 'string' ? args.status.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  role: typeof args.role === 'string' ? args.role : 'seller',
  limit: parseNumber(args.limit),
  offset: parseNumber(args.offset),
  updated_after: typeof args['updated-after'] === 'string' ? args['updated-after'] : undefined
};

const client = createClient();
const result = await client.listJobs(params);
printResult(result);
