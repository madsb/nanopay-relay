#!/usr/bin/env node
import {
  createClient,
  parseArgs,
  parseBool,
  readJsonArg,
  printResult
} from './utils.mjs';

const args = parseArgs();

const offerFromArg = await readJsonArg({
  jsonValue: args.offer,
  filePath: args['offer-file']
});

let offer = offerFromArg;
if (!offer) {
  const title = args.title;
  const description = args.description;
  const pricingMode = args['pricing-mode'];
  if (!title || !description || !pricingMode) {
    console.error('Missing --title, --description, or --pricing-mode');
    process.exit(1);
  }
  offer = {
    title,
    description,
    tags:
      typeof args.tags === 'string'
        ? args.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : undefined,
    pricing_mode: pricingMode,
    fixed_price_raw: args['fixed-price-raw'] ?? undefined,
    active: parseBool(args.active) ?? true
  };
}

const client = createClient();
const result = await client.createOffer(offer);
printResult(result);
