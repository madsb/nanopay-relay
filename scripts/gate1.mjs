import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/nanopay_relay?sslmode=disable';

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code}`));
    });
  });

const startRelay = () => {
  const tsxPath = resolve('node_modules/.bin/tsx');
  return spawn(tsxPath, ['watch', 'apps/relay/src/index.ts'], {
    stdio: 'inherit',
    env: process.env
  });
};

const waitForHealth = async () => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://localhost:3000/health');
      if (response.ok) return true;
    } catch {
      // ignore until ready
    }
    await delay(500);
  }
  return false;
};

try {
  await run('pnpm', ['compose:up']);
  await run('node', ['scripts/migrate.mjs'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    }
  });

  const relay = startRelay();
  let success = false;
  try {
    success = await waitForHealth();
  } finally {
    relay.kill('SIGTERM');
    await delay(300);
  }

  if (!success) {
    throw new Error('Health check failed');
  }

  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
