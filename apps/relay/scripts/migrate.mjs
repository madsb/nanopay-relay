import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL must be set');
  process.exit(1);
}

// When run via pnpm filter, cwd will be apps/relay.
const migrationsDir = path.resolve(process.cwd(), 'migrations');
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const upSection = sql.split('-- migrate:down')[0].replace('-- migrate:up', '');
    await client.query(upSection);
    console.log(`applied ${file}`);
  }
} finally {
  await client.end();
}
