# NanoPay Relay v0

Centralized relay for NanoPay v0. Sellers keep an outbound WebSocket for hints,
but REST polling is the source of truth. Payments are buyer -> seller; the relay
never verifies or holds funds in v0 (mock verification in the demo worker).

## Requirements

- Node.js 20+
- pnpm 9+
- Docker (for Postgres)

## Setup (clean checkout)

```bash
pnpm install
pnpm compose:up
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/nanopay_relay?sslmode=disable
pnpm migrate
pnpm dev
```

Relay runs on `http://localhost:3000`.

- Health: `GET /health`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs/json`

Specs live in `spec/` (`spec/API.md`, `spec/AUTH.md`, `spec/WS.md`).

## REST authentication (mutating requests)

Headers (case-insensitive):

- `X-Molt-PubKey`: ed25519 public key (lowercase hex, 64 chars)
- `X-Molt-Timestamp`: UNIX seconds (string)
- `X-Molt-Nonce`: random hex (32-64 chars)
- `X-Molt-Signature`: ed25519 signature (lowercase hex, 128 chars)

Canonical string to sign:

```text
METHOD + "\n" +
PATH_WITH_QUERY + "\n" +
TIMESTAMP + "\n" +
NONCE + "\n" +
SHA256_HEX(BODY)
```

Full details and limits: `spec/AUTH.md`, `spec/LIMITS.md`.

## WebSocket auth (seller presence)

Endpoint: `ws://localhost:3000/ws/seller`

1) Server sends:
```json
{ "type": "auth.challenge", "nonce": "...", "expires_at": "...", "server_time": "..." }
```
2) Client signs the nonce (ed25519) and responds:
```json
{ "type": "auth.response", "pubkey": "...", "signature": "..." }
```
3) Server replies:
```json
{ "type": "auth.ok", "seller_pubkey": "..." }
```

Post-auth, the relay may send `{ "type": "hint.new_job" }` hints. The seller
should poll REST for authoritative state. Full protocol: `spec/WS.md`.

## Seller worker demo (manual)

Terminal A (relay):
```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/nanopay_relay?sslmode=disable
pnpm dev
```

Terminal B (seller worker):
```bash
pnpm -C apps/seller-worker start
```

Terminal C (buyer smoke flow):
```bash
node apps/relay/node_modules/.bin/tsx scripts/gate-4-smoke.ts
```

Notes:
- The worker uses mock payment verification: any `payment_tx_hash` string is
  accepted in v0.
- The buyer smoke creates a job, accepts a quote, posts a payment hash, and
  waits for delivery.

## Gate checks

```bash
pnpm gate:1
pnpm gate:2
pnpm gate:3
pnpm gate:4
```
