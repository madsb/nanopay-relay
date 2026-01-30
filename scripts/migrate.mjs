import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/nanobazaar_relay?sslmode=disable';

const migrationsDir = resolve('apps/relay/migrations');

const runDbmate = () =>
  new Promise((resolve) => {
    const child = spawn(
      'pnpm',
      ['--filter', '@nanobazaar/relay', 'exec', 'dbmate', 'up'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          DBMATE_MIGRATIONS_DIR: migrationsDir
        }
      }
    );

    child.on('exit', (code) => resolve(code ?? 1));
  });

const maxAttempts = 10;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const code = await runDbmate();
  if (code === 0) process.exit(0);
  if (attempt < maxAttempts) {
    console.warn(`dbmate up failed (attempt ${attempt}). Retrying...`);
    await delay(1000);
  } else {
    process.exit(code);
  }
}
