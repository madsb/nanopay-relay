# NEXT - Current Work

Current gate: Gate 3

Implement Gate 3 only. Do not start Gate 4 stabilization work yet.

## Tasks (Gate 3)
1) WebSocket presence
- Implement `/ws/seller` auth handshake per `spec/WS.md`.
- Track online sellers and expose to offers search via `online_only` filter.

2) Hint notifications
- Emit `{ "type": "hint.new_job" }` to online sellers on job create, accept, and payment.

3) Seller worker flow (mock payment)
- Seller-worker connects via WS, registers a demo offer, polls jobs.
- Quote, accept payment hash, lock, execute dummy task, deliver result.

4) Smoke test
- Add a script that runs a buyer->seller flow with mock payment verification.
- Ensure `pnpm gate:3` passes.
