# NEXT - Current Work

Current gate: Gate 1

Implement Gate 1 only. Do not implement auth, offers, jobs, or worker yet.

## Tasks (Gate 1)
1) Create pnpm workspace monorepo structure:
- apps/relay
- apps/seller-worker (empty placeholder)
- packages/shared (empty placeholder)
- scripts/
- spec/ (empty placeholder)
- codex/ (this folder)

2) Add root tooling:
- package.json with workspace scripts
- pnpm-workspace.yaml
- Node version pin (.nvmrc or volta config)
- TypeScript config base (tsconfig.base.json)

3) Docker + Postgres for local dev:
- root docker-compose.yml with postgres service
- env example for DB connection (e.g. .env.example)

4) Relay app scaffold:
- apps/relay package.json
- Fastify server with:
  - GET /health -> 200 { ok: true }
  - Swagger/OpenAPI enabled and reachable
- Minimal config loading (env vars for DB connection)

5) Migrations via dbmate:
- apps/relay/migrations folder
- dbmate config (via env DATABASE_URL)
- Add one initial migration that creates a trivial table (e.g. _init_check) to prove migrations run

6) Scripts (must work):
- pnpm compose:up (starts postgres)
- pnpm migrate (runs dbmate up)
- pnpm dev (starts relay in watch mode)
- pnpm gate:1 (compose up -> migrate -> start relay -> curl /health -> exit success)

## Commands to verify (Gate 1)
- pnpm compose:up
- pnpm migrate
- pnpm dev
- pnpm gate:1

When Gate 1 passes:
- Create codex/SNAPSHOT-G1.md summarizing what’s done and exact commands/output (brief).
- Update codex/NEXT.md to Gate 2 tasks only (do not implement them yet).
