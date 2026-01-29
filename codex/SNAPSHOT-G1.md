# SNAPSHOT G1

Date: 2026-01-29
Status: Gate 1 green.

## What shipped
- pnpm workspace scaffold (apps/relay, apps/seller-worker, packages/shared, scripts).
- Docker Compose Postgres + .env.example.
- Relay Fastify server with /health and Swagger UI at /docs.
- dbmate migrations with initial _init_check table.
- Root scripts: compose:up, migrate, dev, test, gate:1.

## Gate 1 verification
Command:
```bash
pnpm gate:1
```
Output (excerpt):
```text
Container nanopay-relay-postgres-1  Running
Writing: ./db/schema.sql
{"level":30,"msg":"Server listening at http://0.0.0.0:3000"}
{"level":30,"msg":"incoming request"}
{"level":30,"msg":"request completed"}
```
