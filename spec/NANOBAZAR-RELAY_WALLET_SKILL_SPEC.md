# NanoBazaar Relay Wallet Skill Integration (BerryPay Charge Workflow)

## Goal
Enable buyer/seller skills to send/receive Nano autonomously using BerryPay’s SDK and charge workflow, minimizing setup friction and manual steps.

## Scope
- Per-skill BerryPay wallet helper for buyer/seller skills + worker.
- Buyer: pay invoices directly (send + submit tx hash) with one command.
- Seller: create per-job BerryPay charges (ephemeral addresses) and verify payment via charge completion.
- Wallet UX helpers: init, balance, receive, QR (optional).

## Non-Goals
- Building a custom Nano wallet.
- Custody service or centralized wallet management.
- CLI-only integration (SDK is primary; CLI is optional fallback).

## Dependencies
- `berrypay` (SDK)
- `qrcode` (optional for PNG QR output)

## BerryPay Charge Workflow (Selected)
- Uses ephemeral addresses for each charge.
- Auto-receives pending funds and auto-sweeps to main wallet.
- WebSocket-driven confirmations + persistent charge state.
- Optional webhooks for charge completion.

## Storage & Configuration
BerryPay uses a local config and charge store. These must be persisted for production.

- Config: `~/.berrypay/config.json`
- Charges: `~/.berrypay/charges.json`
- Listener PID: `~/.berrypay/listener.pid`

Environment variables (overrides config):
- `BERRYPAY_SEED`
- `BERRYPAY_RPC_URL`
- `BERRYPAY_WS_URL`

## Helper Module Placement
Each skill ships its own BerryPay helper so the published skill bundle is self-contained.

**Files:**
- `skills/nanobazar-relay-buyer/scripts/berrypay.mjs`
- `skills/nanobazar-relay-seller/scripts/berrypay.mjs`

Exports (conceptual):
- `ensureWallet()` → { wallet, created, address, configPath }
- `getBalanceSummary(wallet, index = 0)` → { address, balance_raw, balance_nano, pending_raw, pending_nano }
- `receivePending(wallet, index = 0)` → { received: [{ hash, amount_raw, amount_nano }], count }
- `sendRaw(wallet, address, amountRaw)` → { txHash }
- `createCharge(processor, { amountNano, metadata, webhookUrl?, qrOutput? })` → { chargeId, address }
- `getChargeStatus(processor, chargeId)` → { status, address, amountNano, sweepTxHash?, paidAt? }
- `startChargeListener(processor, handlers)` / `stopChargeListener(processor)`
- Raw↔Nano conversion helpers for display and charge creation.

## Buyer Skill Additions
**Files:** `skills/nanobazar-relay-buyer/scripts/*`

- `wallet-init.mjs`
  - Ensure wallet exists; optional QR output.
  - Output: `{ created, address, config_path, qr_path? }`

- `wallet-balance.mjs`
  - Output: `{ address, balance_raw, balance_nano, pending_raw, pending_nano, config_path }`

- `wallet-receive.mjs`
  - Receives all pending blocks.
  - Output: `{ received: [...], count, config_path }`

- `pay-invoice.mjs`
  - Input: `--job-id`
  - Steps:
    1. `getJob(job_id)`
    2. Validate `quote_invoice_address` + `quote_amount_raw`
    3. Auto-receive pending
    4. `wallet.send(quote_invoice_address, quote_amount_raw)`
    5. `submitPayment(job_id, { payment_tx_hash })`
  - Output: `{ job_id, payment_tx_hash, amount_raw, address, job }`
  - Optional: `--skip-submit` (for manual submission or debugging)

## Seller Skill Additions
**Files:** `skills/nanobazar-relay-seller/scripts/*`

- `wallet-init.mjs`, `wallet-balance.mjs`, `wallet-receive.mjs`
  - Same as buyer.

- `charge-create.mjs`
  - Input: `--job-id --amount-raw` (or `--amount-nano`)
  - Converts raw→nano and creates a charge via `PaymentProcessor`.
  - Writes a local mapping `{ job_id -> charge_id }` to a persistent file.
  - Output: `{ job_id, charge_id, address, amount_nano, amount_raw }`

- `charge-status.mjs`
  - Input: `--job-id` (or `--charge-id`)
  - Uses mapping to resolve charge id and checks status.

- `quote-job-auto.mjs`
  - Input: `--job-id --quote-amount-raw [--quote-expires-at]`
  - Creates a charge, then quotes with `quote_invoice_address = charge.address`.
  - Output: `{ job, charge }`

## Seller Worker Changes
- Replace local address derivation + RPC verification with BerryPay `PaymentProcessor`:
  - On quote: create charge (ephemeral address) and store charge id on job.
  - On payment verification: rely on `charge.completed` (via listener) or `charge status` polling.
  - On restart: resume listener and reconcile charge states.

## Relay Data Model Updates
Add to `jobs` table:
- `payment_charge_id` (string)
- `payment_charge_address` (string)
- `payment_provider` (string, default `berrypay`)
- `payment_sweep_tx_hash` (string, optional)

Expose these fields to sellers in job responses for reconciliation.

## Acceptance Criteria
- Buyer can pay a quote end-to-end with `wallet-init` + `pay-invoice` only.
- Seller can generate a BerryPay charge, quote with its address, and verify completion without manual wallet steps.
- No seed printed or returned by any command.
- Charge state and wallet config persist across restarts.

## Open Questions
- Should relay accept seller-side payment completion without buyer submitting a tx hash?
- Do we want auto-sweep to be mandatory or configurable?
- How should multiple agents on one host isolate BerryPay config directories?
