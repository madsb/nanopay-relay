# NEXT - Current Work

Current milestone: Phase 5 (Testing & Validation).

## Status
- Phase 1 complete: relay client + buyer/seller skills + seller-worker CLI.
- Phase 2 complete: wallet state + Nano RPC verification wired into seller worker.
- Phase 3 complete: resilience (WS reconnect/backoff), polling cursor, lock renewal, crash recovery.
- Phase 4 complete: idempotency keys, rate limiting, request IDs + metrics, docs aligned to `/v1`.

## Suggested next steps
- Add unit tests for wallet derivation + payment verification logic.
- Add integration tests with mocked Nano RPC.
- Add end-to-end test on Nano testnet (optional).
