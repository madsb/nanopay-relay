# Implementation Plan: BerryPay Charge Workflow

## Objective
Implement frictionless autonomous Nano payments for buyer and seller skills by adopting BerryPay’s charge workflow end-to-end.

## Phase 1 — Foundations
- Add `berrypay` (SDK) and `qrcode` to workspace dependencies.
- Create shared helper module `skills/nanorelay-common/berrypay.mjs`:
  - Wallet init, balance, receive, send, charge create/status/listen.
  - Raw↔Nano conversion helpers.
- Define persistent mapping file for `job_id -> charge_id` (e.g. `~/.nanopay-relay/charge-map.json`).

## Phase 2 — Buyer Skill Automation
- Add scripts to `skills/nanorelay-buyer/scripts`:
  - `wallet-init.mjs`, `wallet-balance.mjs`, `wallet-receive.mjs`.
  - `pay-invoice.mjs` (send + submit payment hash).
- Update buyer `SKILL.md` with new commands and env vars.

## Phase 3 — Seller Skill + Worker Integration
- Add scripts to `skills/nanorelay-seller/scripts`:
  - `wallet-init.mjs`, `wallet-balance.mjs`, `wallet-receive.mjs`.
  - `charge-create.mjs`, `charge-status.mjs`, `quote-job-auto.mjs`.
- Update seller worker:
  - Replace `NanoWallet` + `NanoRpcClient` verification with BerryPay `PaymentProcessor`.
  - Create a charge per job and quote with its address.
  - Listen for `charge.completed` and reconcile on restart.

## Phase 4 — Relay + Data Model
- Add DB columns to `jobs`:
  - `payment_charge_id`, `payment_charge_address`, `payment_provider`, `payment_sweep_tx_hash`.
- Expose seller-facing fields in job responses.
- Decide whether `/v1/jobs/:id/payment` should accept seller-side completion (optional extension).

## Phase 5 — Tests + E2E
- Unit tests for BerryPay helper module.
- Integration tests for charge creation + status polling (mocked).
- Mainnet E2E flow (buyer pay → seller charge completion → delivery).

## Phase 6 — Docs + Ops
- Update `docs/MOLTBOT_SKILL.md` with new commands and env setup.
- Update `docs/PRODUCTION_CHECKLIST.md` with BerryPay persistence + wallet backup notes.
- Add a migration/upgrade note for existing sellers.

## Exit Criteria
- Buyer can run `wallet-init` then `pay-invoice` to complete a paid job autonomously.
- Seller can auto-quote with a charge address and proceed on charge completion.
- Restarting the worker does not lose charge state.
- Production checklist updated and validated on mainnet.
