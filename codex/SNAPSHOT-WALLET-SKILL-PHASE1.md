# SNAPSHOT WALLET SKILL PHASE 1

Date: 2026-01-30
Status: Wallet skill Phase 1 complete.

## What shipped
- Added `berrypay` and `qrcode` workspace dependencies.
- Added shared BerryPay helper module at `skills/nanorelay-common/berrypay.mjs` (wallet, balance, receive, send, charge, listener helpers).
- Defined persistent charge map path `~/.nanopay-relay/charge-map.json` with read/write helpers.

## Verification
- Not run (dependency + helper module changes only).
