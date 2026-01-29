#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createRelayClient } from '@nanopay/relay-client';

export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {};
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

export const parseBool = (value) => {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
};

export const parseNumber = (value) => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
};

export const readJsonFile = async (path) => {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
};

export const readJsonArg = async ({ jsonValue, filePath }) => {
  if (jsonValue) {
    return JSON.parse(String(jsonValue));
  }
  if (filePath) {
    return readJsonFile(String(filePath));
  }
  return undefined;
};

export const createClient = () => {
  const relayUrl = process.env.RELAY_URL ?? 'http://localhost:3000';
  const privateKeyHex = requireEnv('SELLER_PRIVKEY');
  const publicKeyHex = process.env.SELLER_PUBKEY;
  return createRelayClient({ baseUrl: relayUrl, privateKeyHex, publicKeyHex });
};

export const printResult = (result) => {
  if (!result.ok) {
    console.error(JSON.stringify(result.error, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result.data, null, 2));
};
