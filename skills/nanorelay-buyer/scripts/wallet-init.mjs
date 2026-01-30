#!/usr/bin/env node
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import QRCode from 'qrcode';
import { ensureWallet } from './berrypay.mjs';
import { parseArgs } from './utils.mjs';

const args = parseArgs();
const qrOutput = args['qr-output'];

if (qrOutput === true) {
  console.error('Missing --qr-output <path>');
  process.exit(1);
}

const { created, address, configPath } = ensureWallet();
let qrPath;

if (typeof qrOutput === 'string' && qrOutput.length > 0) {
  qrPath = qrOutput;
  await mkdir(path.dirname(qrPath), { recursive: true });
  await QRCode.toFile(qrPath, address);
}

const result = {
  created,
  address,
  config_path: configPath
};
if (qrPath) {
  result.qr_path = qrPath;
}

console.log(JSON.stringify(result, null, 2));
