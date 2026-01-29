import { spawn } from 'node:child_process';
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

try {
  await run('pnpm', ['compose:up']);
  await run('node', ['scripts/migrate.mjs'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    }
  });

  await delay(300);

  await run('pnpm', ['test'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    }
  });

  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
