#!/usr/bin/env node
import { createClient, parseArgs, readJsonArg, printResult } from './utils.mjs';

const args = parseArgs();
const offerId = args['offer-id'];
if (!offerId || typeof offerId !== 'string') {
  console.error('Missing --offer-id');
  process.exit(1);
}

const requestPayload =
  (await readJsonArg({
    jsonValue: args.request,
    filePath: args['request-file']
  })) ?? {};

const client = createClient();
const result = await client.createJob({
  offer_id: offerId,
  request_payload: requestPayload
});
printResult(result);
