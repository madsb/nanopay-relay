You are a coding agent implementing a project called “NanoPay Relay v0” as a monorepo. Goal: fastest working v0, fully reproducible, with a great developer experience. Do not add v1 features (URS, reputation, event replay, subjobs, encryption, complex pricing). Implement exactly what is described below.

TECH STACK (fixed):
- Language: TypeScript, Node 20+
- Monorepo: pnpm workspaces (and optionally turborepo if it helps)
- Relay server: Fastify + @fastify/websocket
- Validation: Zod (runtime validation for all inputs)
- OpenAPI: @fastify/swagger + @fastify/swagger-ui (generate docs)
- DB: Postgres (Docker for local), SQL migrations via dbmate
- Query layer: Kysely (typed SQL)
- Crypto: tweetnacl for ed25519 signatures
- Tests: Vitest; Fastify inject() for API tests
- HTTP client: undici
- Logging: Fastify default pino

ARCHITECTURE:
Monorepo layout:
- apps/relay (Fastify REST + WS, Postgres, migrations)
- apps/seller-worker (reference seller client that connects outbound WS and polls REST)
- packages/shared (Zod schemas, shared enums/types, canonical signing/verification, typed client helpers)
- scripts (dev-up, smoke test)
- spec (markdown docs)

V0 SCOPE (must implement):
Core product: a centralized relay that stores offers and jobs. Sellers are outbound-only via WebSocket hints. Jobs are explicitly addressed to one offer/seller (no auto matching). Payments happen directly buyer->seller in Nano; relay does not verify. Buyer submits nano tx hash; seller verifies and then runs.

Hard cuts for v0:
- No URS, reputation, feedback, usage metrics
- No event queue/ack/replay: WS is advisory only. Seller must poll jobs.
- No progress streaming/messages beyond final result
- No file uploads, JSON payloads only

IDENTITY + AUTH:
- Identity is ed25519 pubkey.
- Implement REST signature auth for all mutating endpoints using headers:
  X-Molt-PubKey, X-Molt-Timestamp, X-Molt-Nonce, X-Molt-Signature
- Signature is over canonical string:
  METHOD + "\n" + PATH_WITH_QUERY + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + SHA256_HEX(BODY_BYTES)
- Relay validates signature, timestamp within ±60s, and nonce uniqueness per pubkey for 10 minutes (store in Postgres table for v0).
- WebSocket auth: server sends nonce challenge; seller signs nonce; relay associates connection with seller_pubkey.

DATA MODEL (Postgres):
Create SQL migrations with dbmate under apps/relay/migrations.
Tables:
offers:
- offer_id uuid pk
- seller_pubkey text not null
- title text not null
- description text not null
- tags text[] not null default '{}'
- pricing_mode text not null check in ('fixed','quote')
- fixed_price_raw text null
- active boolean not null default true
- created_at timestamptz not null default now()

jobs:
- job_id uuid pk
- offer_id uuid not null references offers(offer_id)
- seller_pubkey text not null
- buyer_pubkey text not null
- status text not null check in ('requested','quoted','accepted','running','delivered','failed','canceled','expired')
- request_payload jsonb not null
- quote_amount_raw text null
- quote_invoice_address text null
- quote_expires_at timestamptz null
- payment_tx_hash text null
- lock_owner text null
- lock_expires_at timestamptz null
- result_payload jsonb null
- error jsonb null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

nonces:
- pubkey text not null
- nonce text not null
- created_at timestamptz not null default now()
Primary key (pubkey, nonce). Add cleanup note; no sweeper required in v0.

Indexes:
- offers(active), offers(seller_pubkey), offers(tags)
- jobs(seller_pubkey, status, created_at), jobs(buyer_pubkey, created_at)

PAYLOAD LIMITS (enforce in relay):
- request_payload max 64 KB
- result_payload max 256 KB
Reject if exceeded.

API (versioned /v1):
Offers:
- POST /v1/offers (seller auth required) create offer
- GET /v1/offers?query=&tags=tag1,tag2&online_only=true list/search offers; online_only filters by active WS presence
Jobs:
- POST /v1/jobs (buyer auth required) create job for offer_id + request_payload
- GET /v1/jobs/:id (auth required; only buyer_pubkey or seller_pubkey can read)
- POST /v1/jobs/:id/quote (seller auth required) allowed only when status=requested; sets quoted fields
- POST /v1/jobs/:id/accept (buyer auth required) allowed only when status=quoted and now < quote_expires_at; sets status=accepted
- POST /v1/jobs/:id/payment (buyer auth required) allowed only when status=accepted; stores payment_tx_hash (does NOT change status)
- POST /v1/jobs/:id/lock (seller auth required) allowed only when status=accepted; sets status=running + lock_owner + lock_expires_at (2 minutes)
- POST /v1/jobs/:id/deliver (seller auth required) allowed only when status=running and lock_owner matches; sets status=delivered|failed and stores result_payload or error
- POST /v1/jobs/:id/cancel (buyer auth required) allowed only when status in ('requested','quoted','accepted'); sets status=canceled

WebSocket:
- WS /ws/seller
- After auth, relay tracks seller online presence.
- Relay sends {"type":"hint.new_job"} to seller when:
  - job created for that seller (requested)
  - job accepted
  - payment_tx_hash posted
WS is advisory only; seller must poll REST.

SELLER WORKER (apps/seller-worker):
- Loads config from env: RELAY_URL, SELLER_PRIVKEY, NANO_SEED (stub ok), NANO_RPC_URL (stub ok)
- Connects WS and authenticates
- On startup registers one demo offer (web_extract)
- Poll loop every 2s:
  - fetch jobs for seller where status in ('requested','accepted')
  - if requested: create quote (amount_raw fixed for demo) + unique invoice address (stub generator ok) + quote_expires_at now+10m -> POST quote
  - if accepted and payment_tx_hash exists: verify payment (for v0: implement mock verifier that accepts any non-empty hash, but structure code so real verification can be added later) -> POST lock -> execute dummy function -> POST deliver
Dummy execution: return {"markdown":"..."} derived from input url.

SMOKE TEST (scripts/smoke.ts):
- Starts by creating a seller offer (or assumes worker created it), then buyer creates job, seller quotes (can be done by running worker concurrently), buyer accepts, buyer posts payment hash, worker delivers, buyer fetches delivered job and asserts result exists.
Provide instructions in README on how to run smoke test.

DX REQUIREMENTS (non-negotiable):
- One command to start local deps: docker compose up -d postgres
- One command to run migrations: pnpm migrate (dbmate up)
- One command to run relay dev: pnpm dev (watch mode)
- One command to run seller-worker: pnpm worker
- One command to run smoke: pnpm smoke
- Include docker-compose.yml at repo root with postgres service.
- Include apps/relay/Dockerfile (build relay for production). Optional worker Dockerfile.

TESTS:
- Add minimal unit tests for canonical signing/verifying.
- Add API tests for key endpoints and state transitions using Fastify inject.

DELIVERABLES:
1) Full repo scaffold with the structure above.
2) Working relay and worker per v0.
3) README with exact commands to run locally and run smoke test.

IMPLEMENTATION PLAN:
Work in four gates. Do not move forward until each gate passes.
Gate 1: repo scaffold + postgres compose + dbmate migrations + relay boots + health route + swagger
Gate 2: offers + jobs endpoints + auth + authorization + payload caps; API tests for transitions
Gate 3: WS presence + hint.new_job + seller-worker stub end-to-end with mock payment verification
Gate 4: smoke script verifies full flow.

Start now with Gate 1 only. After Gate 1 passes, stop and report the commands and output to run it, and what remains for Gate 2.
