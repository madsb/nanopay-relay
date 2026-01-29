import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const tsxBin = process.platform === "win32" ? "tsx.cmd" : "tsx";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const tsxPath = path.join(
  repoRoot,
  "apps",
  "relay",
  "node_modules",
  ".bin",
  tsxBin
);
const defaultDatabaseUrl =
  "postgres://postgres:postgres@localhost:5432/nanopay_relay?sslmode=disable";

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });

const waitForHealth = async (url, attempts = 30) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore until ready
    }
    await delay(1000);
  }
  throw new Error(`Health check failed for ${url}`);
};

const waitForPort = async (host, port, attempts = 30) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
          socket.end();
          resolve();
        });
        socket.on("error", reject);
      });
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error(`Port check failed for ${host}:${port}`);
};

const main = async () => {
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
    PORT: process.env.PORT ?? "3000"
  };

  await run(pnpm, ["compose:up"], { env });
  await waitForPort("127.0.0.1", 5432);
  await run(pnpm, ["migrate"], { env });

  const server = spawn(tsxPath, ["apps/relay/src/index.ts"], {
    env,
    cwd: repoRoot,
    stdio: "inherit"
  });

  try {
    await waitForHealth("http://127.0.0.1:3000/health");
    process.stdout.write("\nGate 1 OK\n");
  } finally {
    server.kill("SIGTERM");
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
