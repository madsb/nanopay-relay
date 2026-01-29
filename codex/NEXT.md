# NEXT - Current Work

Current milestone: Phase 3 (Outbound-only robustness).

## Status
- Phase 1 complete: relay client + buyer/seller skills + seller-worker CLI.
- Phase 2 complete: wallet state + Nano RPC verification wired into seller worker.
- Phase 3 pending: resilience (WS reconnect/backoff), polling cursor, lock renewal, crash recovery.

## Suggested next steps
- Add `updated_after` filtering to `GET /v1/jobs` and worker polling cursor.
- Implement WS reconnect backoff + jitter and lock renewal heartbeat.
- Add startup recovery for in-progress jobs with active locks.
