import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/nanopay_relay?sslmode=disable';

const sellerPrivkey =
  process.env.SELLER_PRIVKEY ??
  'a90f48f3a42f83fb9c5a9c3debd29691e764d01c743b41a735f002cab0265f02d1c228f40a1203c283bdbd5ba53267fcde9cc43928af9e40914b462f007f0d90';

const relayUrl = process.env.RELAY_URL ?? 'http://localhost:3000';

const run = (command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code}`));
    });
  });

const startRelay = () => {
  const tsxPath = resolve('node_modules/.bin/tsx');
  return spawn(tsxPath, ['apps/relay/src/index.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    }
  });
};

const startWorker = () => {
  const tsxPath = resolve('node_modules/.bin/tsx');
  return spawn(tsxPath, ['apps/seller-worker/src/index.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      RELAY_URL: relayUrl,
      SELLER_PRIVKEY: sellerPrivkey
    }
  });
};

const waitForHealth = async () => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${relayUrl}/health`);
      if (response.ok) return true;
    } catch {
      // wait for relay to boot
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
  let worker;

  let success = false;
  try {
    success = await waitForHealth();
    if (!success) throw new Error('Relay health check failed');

    worker = startWorker();
    await delay(1000);

    await run('pnpm', ['smoke'], {
      env: {
        ...process.env,
        RELAY_URL: relayUrl,
        SELLER_PRIVKEY: sellerPrivkey
      }
    });
  } finally {
    if (worker) worker.kill('SIGTERM');
    relay.kill('SIGTERM');
    await delay(300);
  }

  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
