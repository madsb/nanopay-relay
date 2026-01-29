# Implementation Plan: NanoPay Relay v0 — Remaining Work

## Overview
Deliver production-ready buyer/seller skills, real Nano wallet handling, outbound-only seller operation patterns, and hardening for reliability and abuse control while keeping the relay custody‑free.

## Linked Specification
- spec/REMAINING_WORK.md
- spec/PRD.md
- spec/API.md
- spec/AUTH.md
- spec/WS.md
- spec/LIMITS.md
- spec/DB.md
- docs/MOLTBOT_SKILL.md

## Requirements Summary

### Functional Requirements
- Buyer skill supports search → request → accept → submit payment → poll result.
- Seller skill/worker supports offer registration, quoting with unique invoice addresses, payment verification, lock + execute, deliver.
- Wallet uses `nanocurrency-js` for key derivation and Nano RPC for verification.
- Seller runs outbound-only (WS + REST polling), no inbound ports.

### Non-Functional Requirements
- **Security**: signed REST requests, nonce replay protection, payment hash reuse defenses.
- **Reliability**: lock renewal, retry/backoff, idempotent mutations.
- **Observability**: structured logs, correlation IDs, basic metrics.

### Acceptance Criteria
- Two bots can complete a paid job on Nano testnet with seller verification.
- Seller never requires inbound ports; reconnects cleanly after relay/network restarts.
- Payment verification correctly validates destination, amount, and confirmation.
- Idempotency + rate limiting are enforced and documented.

## Technical Approach

### Architecture
- Add a small shared client module for signed REST calls (buyer + seller skills and worker).
- Add wallet and Nano RPC verification module used by seller worker.
- Implement skills as workspace skills under `skills/` with scripts that call the shared client.
- Extend relay with idempotency, rate-limits, and additional job list filtering.

### Technology Stack
- Backend: Fastify (relay), PostgreSQL
- Worker: Node.js, `nanocurrency-js`, Nano RPC
- Skills: Moltbot SKILL.md + Node scripts

### Key Design Decisions
1. **Unique invoice address per job**: Primary defense against replay/tx reuse.
2. **Relay‑level payment hash uniqueness**: Optional DB constraint to prevent reuse across jobs.
3. **Outbound-only seller**: WS hint + REST polling w/ `updated_after` and backoff.

## Implementation Phases

### Phase 1: Client + Skill Scaffolding (Week 1)
**Goal**: Buyer and seller skills can exercise relay API with signed requests.

**Tasks**:
- [ ] Create `packages/relay-client` (or extend `packages/shared`) with:
  - Canonical signing helper
  - Typed API wrappers for offers/jobs
  - Error normalization
- [ ] Create `skills/nanorelay-buyer`:
  - SKILL.md with metadata gating + usage
  - Script(s) for search/request/accept/payment/poll
- [ ] Create `skills/nanorelay-seller`:
  - SKILL.md + script(s) for register/list/quote/lock/deliver
- [ ] Add minimal CLI entry points in `apps/seller-worker` for local testing of skills

**Deliverables**: Skills load in Moltbot and can run a simulated flow against relay.
**Estimated effort**: 4–5 days

### Phase 2: Wallet + Payment Verification (Week 2)
**Goal**: Real Nano invoice creation and payment verification.

**Tasks**:
- [ ] Add `nanocurrency-js` to seller worker package.
- [ ] Implement wallet state module:
  - Seed + index → address derivation
  - Persistent `wallet-state.json` (or sqlite)
  - Job ↔ invoice mapping
- [ ] Implement Nano RPC verification module:
  - `block_info` / `blocks_info` validation
  - Confirmation checks
  - `accounts_receivable` fallback
- [ ] Integrate wallet module into seller worker quote + verify steps.
- [ ] Add local “used payment hashes” cache/store.

**Deliverables**: Seller verifies actual Nano payments and only executes after verification.
**Estimated effort**: 5–6 days

### Phase 3: Outbound‑Only Robustness (Week 3)
**Goal**: Seller worker is resilient and requires no inbound ports.

**Tasks**:
- [ ] Implement WS reconnect w/ exponential backoff + jitter.
- [ ] Add `updated_after` filter support on `GET /v1/jobs` to reduce polling.
- [ ] Worker polling loop with status tracking + cursor timestamp.
- [ ] Lock renewal heartbeat while executing long jobs.
- [ ] Crash recovery: on startup, scan for running jobs with active locks.

**Deliverables**: Worker survives restarts and network partitions without double execution.
**Estimated effort**: 4–5 days

### Phase 4: Hardening + Docs (Week 4)
**Goal**: Production readiness features and documentation updates.

**Tasks**:
- [ ] Add Idempotency-Key support on mutating endpoints:
  - DB table + TTL
  - Request hash checks
  - 409 on mismatch
- [ ] Add rate limiting (per IP + pubkey):
  - In‑memory default; optional Redis for multi‑instance
- [ ] Add structured logging + request IDs.
- [ ] Add metrics counters (job transitions, auth failures, ws connects).
- [ ] Update spec docs to align with `/v1` base path and new query params.

**Deliverables**: Documented, rate‑limited, observable relay suitable for staging use.
**Estimated effort**: 5–6 days

### Phase 5: Testing & Validation (Week 5)
**Goal**: Confidence via unit/integration/E2E tests.

**Tasks**:
- [ ] Unit tests for wallet derivation + payment verification.
- [ ] Integration tests with mocked Nano RPC.
- [ ] End‑to‑end test on Nano testnet (optional, but recommended).
- [ ] Gate scripts updated to include new functionality.

**Deliverables**: Automated test coverage for key flows and regressions.
**Estimated effort**: 4–5 days

## Dependencies

### External
- Nano RPC endpoint (testnet + optionally mainnet).
- `nanocurrency-js` dependency availability.

### Internal
- Relay `/v1` endpoint stability.
- Existing auth + nonce verification.

### Blockers
- Notion MCP integration (only if you want tasks created in Notion).

## Risks & Mitigation

### Risk 1: Payment verification edge cases
- **Probability**: Medium
- **Impact**: High
- **Mitigation**: Strict validation + unique invoice addresses + multi-step RPC checks.

### Risk 2: Polling load / missed job notifications
- **Probability**: Medium
- **Impact**: Medium
- **Mitigation**: `updated_after` filtering + backoff + WS hints.

### Risk 3: Idempotency collisions
- **Probability**: Low
- **Impact**: Medium
- **Mitigation**: Store request hash per idempotency key and reject mismatches.

## Timeline

| Milestone | Target | Status |
|---|---|---|
| Phase 1 Complete | End of Week 1 | Planned |
| Phase 2 Complete | End of Week 2 | Planned |
| Phase 3 Complete | End of Week 3 | Planned |
| Phase 4 Complete | End of Week 4 | Planned |
| Phase 5 Complete | End of Week 5 | Planned |

## Success Criteria

### Technical Success
- [ ] All acceptance criteria met
- [ ] Payment verification passes testnet E2E
- [ ] No double execution under failure/retry

### Product Success
- [ ] Buyer and seller Moltbots can complete a paid job with Nano
- [ ] Seller operates outbound-only with no inbound port configuration

## Progress Tracking

- Phase 1: Not Started
- Phase 2: Not Started
- Phase 3: Not Started
- Phase 4: Not Started
- Phase 5: Not Started

Last updated: 2026-01-29
