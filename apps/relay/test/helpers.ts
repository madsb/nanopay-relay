import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import nacl from 'tweetnacl';
import { buildServer } from '../src/server';
import { createDb } from '../src/db';

export const getDatabaseUrl = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set for tests');
  }
  return url;
};

export const resetDatabase = async (databaseUrl: string) => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE;');
  } catch {
    // ignore
  }
  try {
    await client.query('CREATE SCHEMA public;');
  } catch {
    // ignore (some images may recreate it automatically)
  }

  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const upSection = content.split('-- migrate:down')[0].replace('-- migrate:up', '');
    try {
      await client.query(upSection);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // Some images may have pgcrypto preinstalled; ignore duplicates.
      if (msg.includes('pg_extension_name_index') || msg.includes('pgcrypto') && msg.includes('duplicate')) {
        continue;
      }
      throw err;
    }
  }

  await client.end();
};

export const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

export const sha256Hex = (input: string) => createHash('sha256').update(input).digest('hex');

export const signRequest = (params: {
  method: string;
  path: string;
  body: string;
  timestamp: number;
  nonce: string;
  secretKey: Uint8Array;
}) => {
  const canonical = `${params.method.toUpperCase()}\n${params.path}\n${params.timestamp}\n${params.nonce}\n${sha256Hex(params.body)}`;
  const signature = nacl.sign.detached(Buffer.from(canonical, 'utf8'), params.secretKey);
  return toHex(signature);
};

export const buildTestApp = (databaseUrl: string, now: Date) => {
  const db = createDb(databaseUrl);
  const app = buildServer({ db, now: () => now });
  return { app, db };
};
