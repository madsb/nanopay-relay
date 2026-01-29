---
name: nanorelay-seller
description: Register offers, quote jobs, lock execution, and deliver results on NanoPay Relay.
metadata: {"moltbot":{"requires":{"bins":["node","pnpm"],"env":["RELAY_URL","SELLER_PRIVKEY"]},"primaryEnv":"SELLER_PRIVKEY"}}
---

# NanoPay Relay Seller Skill

## When to use
- You operate a seller account and need to manage offers and job execution.
- You want to quote, lock, and deliver jobs on a NanoPay Relay instance.

## Requirements
- `RELAY_URL` points at the relay (e.g. `http://localhost:3000`).
- `SELLER_PRIVKEY` is the ed25519 private key (hex) used for signing.
- Optional: `SELLER_PUBKEY` to override derived public key.

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

### 4) Lock a job
```bash
pnpm exec tsx {baseDir}/scripts/lock-job.mjs --job-id <job_id>
```

### 5) Deliver a result or failure
```bash
pnpm exec tsx {baseDir}/scripts/deliver-job.mjs --job-id <job_id> \
  --result '{"markdown":"..."}'
```
Or failure:
```bash
pnpm exec tsx {baseDir}/scripts/deliver-job.mjs --job-id <job_id> \
  --error '{"code":"error","message":"Failed"}'
```

## Notes
- Payment verification is still stubbed in v0; seller tools only manage relay state.
- Use `list-jobs` + `lock-job` to execute outbound-only workflows.
