#!/usr/bin/env node
import {
  createClient,
  parseArgs,
  parseBool,
  parseNumber,
  printResult
} from './utils.mjs';

const args = parseArgs();
const client = createClient();

const params = {
  q: typeof args.q === 'string' ? args.q : undefined,
  tags:
    typeof args.tags === 'string'
      ? args.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : undefined,
  seller_pubkey: typeof args['seller-pubkey'] === 'string' ? args['seller-pubkey'] : undefined,
  pricing_mode: typeof args['pricing-mode'] === 'string' ? args['pricing-mode'] : undefined,
  active: parseBool(args.active),
  online_only: parseBool(args['online-only']),
  limit: parseNumber(args.limit),
  offset: parseNumber(args.offset)
};

const result = await client.listOffers(params);
printResult(result);
