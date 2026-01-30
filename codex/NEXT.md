# NEXT - Current Work

Current milestone: Phase 5 complete (Testing & Validation).

## Status
- Phase 1 complete: relay client + buyer/seller skills + seller-worker CLI.
- Phase 2 complete: wallet state + Nano RPC verification wired into seller worker.
- Phase 3 complete: resilience (WS reconnect/backoff), polling cursor, lock renewal, crash recovery.
- Phase 4 complete: idempotency keys, rate limiting, request IDs + metrics, docs aligned to `/v1`.
- Phase 5 complete: wallet/payment verification tests + mocked Nano RPC integration tests.

## Suggested next steps
- Add an end-to-end test on Nano testnet (optional).
- Consider wiring seller-worker tests into CI alongside gate runs.
