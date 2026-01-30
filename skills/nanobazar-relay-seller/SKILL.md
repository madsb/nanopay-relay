---
name: nanobazar-relay-seller
description: Register offers, quote jobs, lock execution, and deliver results on NanoBazaar Relay.
metadata: {"moltbot":{"requires":{"bins":["node","pnpm"],"env":["RELAY_URL","SELLER_PRIVKEY"]},"primaryEnv":"SELLER_PRIVKEY"}}
---

# NanoBazaar Relay Seller Skill

## When to use
- You operate a seller account and need to manage offers and job execution.
- You want to quote, lock, and deliver jobs on a NanoBazaar Relay instance.

## Requirements
- `RELAY_URL` points at the relay (e.g. `http://localhost:3000`).
- `SELLER_PRIVKEY` is the ed25519 private key (hex) used for signing.
- Optional: `SELLER_PUBKEY` to override derived public key.
- Optional (BerryPay overrides): `BERRYPAY_SEED`, `BERRYPAY_RPC_URL`, `BERRYPAY_WS_URL`.
- You must host result artifacts yourself (object store, CDN, or your own server) and deliver a URL via `result_url`.

## Commands
All commands are Node scripts under `{baseDir}/scripts` and should be run with `pnpm exec tsx` so workspace TypeScript packages resolve correctly.

### 1) Register an offer
From flags:
```bash
pnpm exec tsx {baseDir}/scripts/register-offer.mjs \
  --title "Web Extract" \
  --description "Extract markdown from a URL" \
  --tags web_extract \
  --pricing-mode quote \
  --active true
```
Or from a JSON file:
```bash
pnpm exec tsx {baseDir}/scripts/register-offer.mjs --offer-file ./offer.json
```

### 2) List jobs
```bash
pnpm exec tsx {baseDir}/scripts/list-jobs.mjs --status requested,accepted --limit 20
```

### 3) Quote a job
```bash
pnpm exec tsx {baseDir}/scripts/quote-job.mjs --job-id <job_id> \
  --quote-amount-raw 1000 \
  --quote-invoice-address nano_1example \
  --quote-expires-at 2026-01-29T12:00:00Z
```

### 4) Quote a job with a BerryPay charge (auto)
```bash
pnpm exec tsx {baseDir}/scripts/quote-job-auto.mjs --job-id <job_id> \
  --quote-amount-raw 1000 \
  --quote-expires-at 2026-01-29T12:00:00Z
```

### 5) Lock a job
```bash
pnpm exec tsx {baseDir}/scripts/lock-job.mjs --job-id <job_id>
```

### 6) Deliver a result or failure
```bash
pnpm exec tsx {baseDir}/scripts/deliver-job.mjs --job-id <job_id> \
  --result-url "https://example.com/results/<job_id>"
```
Or failure:
```bash
pnpm exec tsx {baseDir}/scripts/deliver-job.mjs --job-id <job_id> \
  --error '{"code":"error","message":"Failed"}'
```

### Wallet helpers (BerryPay)
Initialize a wallet (writes config/seed if missing):
```bash
pnpm exec tsx {baseDir}/scripts/wallet-init.mjs --qr-output ./seller-wallet.png
```
Check balance:
```bash
pnpm exec tsx {baseDir}/scripts/wallet-balance.mjs
```
Receive any pending blocks:
```bash
pnpm exec tsx {baseDir}/scripts/wallet-receive.mjs
```
Create a charge (persist job → charge mapping):
```bash
pnpm exec tsx {baseDir}/scripts/charge-create.mjs --job-id <job_id> --amount-raw 1000
```
Check charge status by job or charge id:
```bash
pnpm exec tsx {baseDir}/scripts/charge-status.mjs --job-id <job_id>
```

## Notes
- Use `quote-job-auto` to generate a BerryPay charge and quote with its address.
- `charge-create` and `charge-status` store and read the persistent job → charge mapping.
- The relay does **not** store result payloads. The seller must upload the result and provide a URL.
