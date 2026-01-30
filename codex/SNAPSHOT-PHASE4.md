# SNAPSHOT PHASE 4

Date: 2026-01-30
Status: Phase 4 complete.

## What shipped
- Added idempotency keys with DB backing, replay handling, and conflict detection.
- Implemented rate limiting per IP + pubkey with stricter limits on `POST /v1/jobs` and `POST /v1/offers`.
- Added request IDs, structured job transition logs, WS/auth metrics, and a `/metrics` snapshot endpoint.
- Updated specs to align `/v1` paths, idempotency behavior, and rate limits.

## Verification
- Not run (not requested).
