import { readFile } from 'node:fs/promises';
import { createRelayClient, type OfferCreate } from '@nanopay/relay-client';

const parseArgs = (argv: string[]) => {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (!entry.startsWith('--')) continue;
    const trimmed = entry.slice(2);
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex !== -1) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      args[key] = value;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[trimmed] = true;
      continue;
    }
    args[trimmed] = next;
    i += 1;
  }
  return args;
};

const parseBool = (value: string | boolean | undefined) => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return undefined;
};

const parseNumber = (value: string | boolean | undefined) => {
  if (value === undefined || value === true || value === false) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readJsonFile = async (path: string) => {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
};

const readJsonArg = async (
  jsonValue: string | boolean | undefined,
  filePath: string | boolean | undefined
) => {
  if (typeof jsonValue === 'string') {
    return JSON.parse(jsonValue);
  }
  if (typeof filePath === 'string') {
    return readJsonFile(filePath);
  }
  return undefined;
};

const printResult = (result: { ok: boolean; data?: unknown; error?: unknown }) => {
  if (!result.ok) {
    console.error(JSON.stringify(result.error, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result.data, null, 2));
};

const printUsage = () => {
  console.log(`NanoPay seller CLI\n\nCommands:\n  register-offer --title <title> --description <desc> --pricing-mode <fixed|quote> [--tags a,b] [--fixed-price-raw 123] [--active true]\n  register-offer --offer-file <path>\n  list-jobs [--status requested,accepted] [--limit 20] [--offset 0] [--updated-after <ts>]\n  quote-job --job-id <id> --quote-amount-raw <raw> --quote-invoice-address <addr> [--quote-expires-at <ts>]\n  lock-job --job-id <id>\n  deliver-job --job-id <id> (--result-url <url> | --error <json> | --error-file <path>)\n`);
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  const relayUrl = process.env.RELAY_URL ?? 'http://localhost:3000';
  const privateKeyHex = process.env.SELLER_PRIVKEY;
  const publicKeyHex = process.env.SELLER_PUBKEY;
  if (!privateKeyHex) {
    console.error('SELLER_PRIVKEY is required');
    process.exit(1);
  }

  const client = createRelayClient({
    baseUrl: relayUrl,
    privateKeyHex,
    publicKeyHex,
    userAgent: 'nanopay-seller-cli'
  });

  const args = parseArgs(rest);

  switch (command) {
    case 'register-offer': {
      const offerFromArg = await readJsonArg(args.offer, args['offer-file']);
      let offer: OfferCreate | undefined = offerFromArg as OfferCreate | undefined;
      if (!offer) {
        const title = args.title;
        const description = args.description;
        const pricingMode = args['pricing-mode'];
        if (
          typeof title !== 'string' ||
          typeof description !== 'string' ||
          typeof pricingMode !== 'string'
        ) {
          console.error('Missing --title, --description, or --pricing-mode');
          process.exit(1);
        }
        offer = {
          title,
          description,
          pricing_mode: pricingMode as OfferCreate['pricing_mode'],
          tags:
            typeof args.tags === 'string'
              ? args.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
              : undefined,
          fixed_price_raw:
            typeof args['fixed-price-raw'] === 'string'
              ? args['fixed-price-raw']
              : undefined,
          active: parseBool(args.active)
        };
      }
      const result = await client.createOffer(offer);
      printResult(result);
      return;
    }
    case 'list-jobs': {
      const result = await client.listJobs({
        status:
          typeof args.status === 'string'
            ? args.status.split(',').map((status) => status.trim()).filter(Boolean)
            : undefined,
        role: 'seller',
        limit: parseNumber(args.limit),
        offset: parseNumber(args.offset),
        updated_after:
          typeof args['updated-after'] === 'string' ? args['updated-after'] : undefined
      });
      printResult(result);
      return;
    }
    case 'quote-job': {
      const jobId = args['job-id'];
      const quoteAmountRaw = args['quote-amount-raw'];
      const quoteInvoiceAddress = args['quote-invoice-address'];
      if (typeof jobId !== 'string') {
        console.error('Missing --job-id');
        process.exit(1);
      }
      if (typeof quoteAmountRaw !== 'string') {
        console.error('Missing --quote-amount-raw');
        process.exit(1);
      }
      if (typeof quoteInvoiceAddress !== 'string') {
        console.error('Missing --quote-invoice-address');
        process.exit(1);
      }
      const result = await client.quoteJob(jobId, {
        quote_amount_raw: quoteAmountRaw,
        quote_invoice_address: quoteInvoiceAddress,
        quote_expires_at:
          typeof args['quote-expires-at'] === 'string'
            ? args['quote-expires-at']
            : undefined
      });
      printResult(result);
      return;
    }
    case 'lock-job': {
      const jobId = args['job-id'];
      if (typeof jobId !== 'string') {
        console.error('Missing --job-id');
        process.exit(1);
      }
      const result = await client.lockJob(jobId);
      printResult(result);
      return;
    }
    case 'deliver-job': {
      const jobId = args['job-id'];
      if (typeof jobId !== 'string') {
        console.error('Missing --job-id');
        process.exit(1);
      }
      const resultUrl = typeof args['result-url'] === 'string' ? args['result-url'] : undefined;
      const errorPayload = await readJsonArg(args.error, args['error-file']);
      const hasResult = resultUrl !== undefined && resultUrl !== null;
      const hasError = errorPayload !== undefined && errorPayload !== null;
      if (hasResult === hasError) {
        console.error('Provide exactly one of --result-url or --error/--error-file');
        process.exit(1);
      }
      const result = await client.deliverJob(jobId, {
        result_url: hasResult ? resultUrl : null,
        error: hasError ? errorPayload : null
      });
      printResult(result);
      return;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
};

void main();
