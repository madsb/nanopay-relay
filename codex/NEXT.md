# NEXT - Current Work

Current milestone: Phase 4 (Hardening + Docs).

## Status
- Phase 1 complete: relay client + buyer/seller skills + seller-worker CLI.
- Phase 2 complete: wallet state + Nano RPC verification wired into seller worker.
- Phase 3 complete: resilience (WS reconnect/backoff), polling cursor, lock renewal, crash recovery.

## Suggested next steps
- Add idempotency key support on mutating endpoints with DB backing.
- Implement rate limiting (per IP + pubkey) and optional Redis integration.
- Add structured logging + request IDs and basic metrics counters.
