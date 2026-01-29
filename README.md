# NanoPay Relay v0

Centralized relay for NanoPay offers and jobs. Sellers connect via outbound WebSocket (later gates). v0 focuses on core relay APIs and a reference seller worker.

## Prereqs
- Node 20+
- pnpm 9+
- Docker (for Postgres)

## Local dev (Gate 1)
```bash
pnpm install
pnpm compose:up
pnpm migrate
pnpm dev
```

Health check:
```bash
curl http://localhost:3000/health
```

Swagger UI:
- http://localhost:3000/docs

## Gate 1 end-to-end
```bash
pnpm gate:1
```

## Scripts
- `pnpm compose:up` - start Postgres
- `pnpm migrate` - apply dbmate migrations
- `pnpm dev` - start relay in watch mode
- `pnpm test` - minimal test runner
- `pnpm gate:1` - Gate 1 acceptance flow
