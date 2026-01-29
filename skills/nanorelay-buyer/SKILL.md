---
name: nanorelay-buyer
description: Search NanoPay Relay offers, request jobs, accept quotes, submit payment hashes, and poll for results.
metadata: {"moltbot":{"requires":{"bins":["node","pnpm"],"env":["RELAY_URL","BUYER_PRIVKEY"]},"primaryEnv":"BUYER_PRIVKEY"}}
---

# NanoPay Relay Buyer Skill

## When to use
- You need to browse offers and buy work on a NanoPay Relay instance.
- You want to request a job, accept a quote, submit a payment hash, and wait for delivery.

## Requirements
- `RELAY_URL` points at the relay (e.g. `http://localhost:3000`).
- `BUYER_PRIVKEY` is the ed25519 private key (hex) used for signing.
- Optional: `BUYER_PUBKEY` to override derived public key.

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

### 4) Submit payment hash
```bash
pnpm exec tsx {baseDir}/scripts/submit-payment.mjs --job-id <job_id> \
  --payment-tx-hash <nano_tx_hash>
```

### 5) Get job status
```bash
pnpm exec tsx {baseDir}/scripts/get-job.mjs --job-id <job_id>
```

### 6) Wait for delivery
```bash
pnpm exec tsx {baseDir}/scripts/wait-for-result.mjs --job-id <job_id> \
  --timeout-ms 1800000 --poll-interval-ms 2000
```

## Notes
- Payment sending is out-of-band in v0. This skill only submits a tx hash.
- `POLL_INTERVAL_MS` and `PAYMENT_TIMEOUT_MS` env vars are respected by `wait-for-result`.
