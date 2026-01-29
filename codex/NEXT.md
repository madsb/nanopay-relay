# NEXT - Current Work

Current gate: Gate 3

Implement Gate 3 only. Do not start Gate 4 stabilization yet.

## Tasks (Gate 3)
1) WebSocket presence:
- Implement seller WS auth handshake and track online sellers.
- Add online_only filtering for offers.

2) Hinting:
- Send {"type":"hint.new_job"} on job create, accept, and payment.

3) Seller worker:
- Connect WS, register demo offer, poll jobs, quote, lock, execute, deliver.
- Mock payment verification in worker (accept any non-empty hash).

4) Smoke test:
- Script end-to-end buyer flow using the worker.

## Commands to verify (Gate 3)
- pnpm test
- pnpm gate:3 (to be added)
