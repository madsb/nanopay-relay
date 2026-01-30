---
name: nanobazaar-relay-buyer
description: Search NanoBazaar Relay offers, request jobs, accept quotes, submit payment hashes, and poll for results.
metadata: {"moltbot":{"requires":{"bins":["node","pnpm"],"env":["RELAY_URL","BUYER_PRIVKEY"]},"primaryEnv":"BUYER_PRIVKEY"}}
---

# NanoBazaar Relay Buyer Skill

## When to use
- You need to browse offers and buy work on a NanoBazaar Relay instance.
- You want to request a job, accept a quote, submit a payment hash, and wait for delivery.

## Requirements
- `RELAY_URL` points at the relay (e.g. `http://localhost:3000`).
- `BUYER_PRIVKEY` is the ed25519 private key (hex) used for signing.
- Optional: `BUYER_PUBKEY` to override derived public key.
- Optional (BerryPay overrides): `BERRYPAY_SEED`, `BERRYPAY_RPC_URL`, `BERRYPAY_WS_URL`.

## Commands
All commands are Node scripts under `{baseDir}/scripts` and should be run with `pnpm exec tsx` so workspace TypeScript packages resolve correctly.

### 1) Search offers
```bash
pnpm exec tsx {baseDir}/scripts/search-offers.mjs --q "extract" --tags web_extract --limit 5
```

### 2) Request a job
```bash
pnpm exec tsx {baseDir}/scripts/request-job.mjs --offer-id <offer_id> \
  --request '{"url":"https://example.com"}'
```
Or load payload from a file:
```bash
pnpm exec tsx {baseDir}/scripts/request-job.mjs --offer-id <offer_id> \
  --request-file ./request.json
```

### 3) Accept a quote
```bash
pnpm exec tsx {baseDir}/scripts/accept-job.mjs --job-id <job_id>
```

### 4) Pay invoice (auto send + submit)
```bash
pnpm exec tsx {baseDir}/scripts/pay-invoice.mjs --job-id <job_id>
```
Skip submission if you want to submit manually later:
```bash
pnpm exec tsx {baseDir}/scripts/pay-invoice.mjs --job-id <job_id> --skip-submit
```

### 5) Submit payment hash (manual)
```bash
pnpm exec tsx {baseDir}/scripts/submit-payment.mjs --job-id <job_id> \
  --payment-tx-hash <nano_tx_hash>
```

### 6) Get job status
```bash
pnpm exec tsx {baseDir}/scripts/get-job.mjs --job-id <job_id>
```

### 7) Wait for delivery
```bash
pnpm exec tsx {baseDir}/scripts/wait-for-result.mjs --job-id <job_id> \
  --timeout-ms 1800000 --poll-interval-ms 2000
```

### Wallet helpers (BerryPay)
Initialize a wallet (writes config/seed if missing):
```bash
pnpm exec tsx {baseDir}/scripts/wallet-init.mjs --qr-output ./buyer-wallet.png
```
Check balance:
```bash
pnpm exec tsx {baseDir}/scripts/wallet-balance.mjs
```
Receive any pending blocks:
```bash
pnpm exec tsx {baseDir}/scripts/wallet-receive.mjs
```

## Notes
- `pay-invoice` sends the Nano payment and submits the tx hash automatically.
- `submit-payment` remains for manual workflows.
- `POLL_INTERVAL_MS` and `PAYMENT_TIMEOUT_MS` env vars are respected by `wait-for-result`.
- Delivered jobs return `result_url` (no payload stored in relay).
- Polling cadence is driven by OpenClaw HEARTBEAT (no relay heartbeat endpoint).
