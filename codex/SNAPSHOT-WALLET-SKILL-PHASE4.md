# SNAPSHOT WALLET SKILL PHASE 4

Date: 2026-01-30
Status: Wallet skill Phase 4 complete.

## What shipped
- Added job payment charge columns + migration/schema updates (`payment_charge_id`, `payment_charge_address`, `payment_provider`, `payment_sweep_tx_hash`).
- Updated relay job types and API/DB docs to include the new charge fields in responses.
- Extended job quoting to accept optional charge metadata (defaults to BerryPay when charge data is supplied).
- Seller worker + `quote-job-auto` now submit BerryPay charge metadata when quoting.
- Kept `/v1/jobs/:id/payment` buyer-only (no seller-side completion added).

## Verification
- Not run (not requested).
