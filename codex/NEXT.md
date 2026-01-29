# NEXT - Current Work

Current gate: Gate 2

Implement Gate 2 only. Do not start Gate 3 WS presence or seller-worker flows yet.

## Tasks (Gate 2)
1) Auth + signatures
- Implement Ed25519 canonical signing/verification in `packages/shared`.
- Add REST auth middleware for mutating routes with nonce replay protection.

2) DB + models
- Add migrations for `offers` and `jobs` per `spec/DB.md`.
- Wire Kysely models/queries in `apps/relay`.

3) Offers endpoints
- POST `/v1/offers`
- GET `/v1/offers` with query/tags/online_only filters

4) Jobs endpoints + state machine
- Implement job lifecycle routes per `spec/API.md` + `spec/PRD.md`.
- Enforce state transitions and authorization rules.

5) Limits + validation
- Enforce payload caps from `spec/LIMITS.md`.
- Zod validation for request/response shapes.

6) Tests + gate
- Add API tests for auth failures and key transitions.
- Ensure `pnpm gate:2` passes.
