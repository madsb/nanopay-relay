# SNAPSHOT WALLET SKILL PHASE 3

Date: 2026-01-30
Status: Wallet skill Phase 3 complete.

## What shipped
- Added seller wallet scripts: `wallet-init.mjs`, `wallet-balance.mjs`, `wallet-receive.mjs`.
- Added seller charge automation scripts: `charge-create.mjs`, `charge-status.mjs`, `quote-job-auto.mjs`.
- Updated seller worker to create BerryPay charges per job, listen for charge completion, and reconcile charge state on restart.
- Updated seller `SKILL.md` with BerryPay env vars and new commands.

## Verification
- Not run (manual scripts).
