# NanoPay Relay v0

Centralized relay for NanoPay offers and jobs. Sellers connect via outbound WebSocket (later gates). v0 focuses on core relay APIs and a reference seller worker.

## Prereqs
- Node 20+
- pnpm 9+
- Docker (for Postgres)

## Local dev (Gate 3)
```bash
pnpm install
pnpm compose:up
pnpm migrate
pnpm dev
```

Run the seller worker (in a second terminal):
```bash
export SELLER_PRIVKEY=a90f48f3a42f83fb9c5a9c3debd29691e764d01c743b41a735f002cab0265f02d1c228f40a1203c283bdbd5ba53267fcde9cc43928af9e40914b462f007f0d90
pnpm worker
```

Health check:
```bash
curl http://localhost:3000/health
```

Swagger UI:
- http://localhost:3000/docs

## Smoke test
With relay + worker running:
```bash
pnpm smoke
```

## Gate 3 end-to-end
```bash
pnpm gate:3
```

## Scripts
- `pnpm compose:up` - start Postgres
- `pnpm migrate` - apply dbmate migrations
- `pnpm dev` - start relay in watch mode
- `pnpm worker` - start the seller worker
- `pnpm smoke` - run the end-to-end smoke test
- `pnpm test` - minimal test runner
- `pnpm gate:1` - Gate 1 acceptance flow
- `pnpm gate:2` - Gate 2 acceptance flow
- `pnpm gate:3` - Gate 3 acceptance flow
