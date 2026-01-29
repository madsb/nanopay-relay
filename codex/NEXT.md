# NEXT - Current Work

Current gate: Gate 2

Implement Gate 2 only. Do not start WS hints, seller-worker flow, or smoke test yet.

## Tasks (Gate 2)
1) Shared auth + signing:
- Implement canonical signing/verification in packages/shared.
- Add tests for signing/verification.

2) Relay auth + nonce:
- REST signature auth middleware for all mutating endpoints.
- Timestamp ±60s and nonce replay protection stored in Postgres.

3) Offers + Jobs API:
- Implement POST/GET /v1/offers and all jobs endpoints per spec.
- Enforce state transitions, authorization, and payload caps.

4) Tests:
- Fastify inject API tests for key transitions and auth failures.

## Commands to verify (Gate 2)
- pnpm test
- pnpm gate:2 (to be added)
