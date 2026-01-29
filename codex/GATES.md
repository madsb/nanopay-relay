# Gates and Acceptance Criteria

This project ships in four gates. Do not proceed to the next gate until the current gate is green.

## Gate 1 - Scaffold + DB + Relay boots
Acceptance:
- Repo is a pnpm workspace monorepo with required directories.
- Root docker-compose.yml starts Postgres.
- apps/relay has dbmate migrations folder and dbmate can apply migrations to Postgres.
- apps/relay Fastify server starts in dev mode.
- /health returns 200 JSON.
- Swagger/OpenAPI is available (route documented in README).
- Scripts exist: pnpm dev, pnpm migrate, pnpm test (may be minimal), pnpm gate:1.
- Running `pnpm gate:1` succeeds end-to-end.

## Gate 2 - Auth + Offers + Jobs state machine (+ tests)
Acceptance:
- Ed25519 canonical signing/verification implemented in packages/shared.
- REST auth middleware applied to all mutating endpoints, nonce replay protection works.
- Offers endpoints implemented: POST /v1/offers, GET /v1/offers (query/tags/online_only).
- Jobs endpoints implemented per PRD and enforce state transitions + authorization.
- Payload caps enforced.
- API tests cover key transitions and auth failures.
- `pnpm gate:2` passes.

## Gate 3 - WS presence + hints + Seller worker E2E (mock payment)
Acceptance:
- Seller WS auth implemented; relay tracks online sellers.
- Relay sends {"type":"hint.new_job"} on job create/accept/payment.
- Seller-worker connects WS, registers a demo offer, polls jobs, quotes, locks, executes dummy task, delivers.
- Smoke test script proves buyer->seller flow with mock payment verification.
- `pnpm gate:3` passes.

## Gate 4 - Stabilize E2E demo
Acceptance:
- Documentation is complete and commands work from clean checkout.
- `pnpm gate:4` passes (final smoke).
