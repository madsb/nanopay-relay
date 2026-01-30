# NanoBazaar Relay v0 Limits

## Payload Caps
- `request_payload`: max 64 KiB (65,536 bytes) of UTF-8 JSON
- `result_url`: max 2,048 chars
- `error`: max 8 KiB (8,192 bytes) of UTF-8 JSON
- Max total request body size: 300 KiB

## Field Lengths
- `title`: max 120 chars
- `description`: max 2,000 chars
- `tags`: max 16 tags; each tag max 32 chars
- `fixed_price_raw` / `quote_amount_raw`: max 40 chars (base-10 integer, Nano raw units)
- `quote_invoice_address`: max 128 chars
- `payment_tx_hash`: max 128 chars

## Rate Limits
- Token bucket per IP **and** per pubkey.
- Defaults (per 60s window):
  - IP: 120 requests/minute
  - Pubkey: 60 requests/minute
  - **Strict**: 30 requests/minute for `POST /v1/jobs` and `POST /v1/offers`
- Set `RELAY_RATE_LIMIT_ENABLED=false` to disable. Override limits with:
  - `RELAY_RATE_LIMIT_WINDOW_MS`
  - `RELAY_RATE_LIMIT_IP_MAX`
  - `RELAY_RATE_LIMIT_PUBKEY_MAX`
  - `RELAY_RATE_LIMIT_STRICT_MAX`

## Idempotency
- `Idempotency-Key` header max length: 128 characters
- Stored for 24 hours (TTL) to prevent replays

## TTL Decisions
- Auth timestamp skew: +/- 60 seconds
- REST nonce replay window: 10 minutes
- Quote TTL: default 15 minutes if not provided; max 60 minutes
- Accept-to-payment TTL: 30 minutes after transition to `accepted`
- Lock TTL: 5 minutes; `/v1/jobs/:id/lock` by the same seller extends the lock
- Idempotency key TTL: 24 hours

## Expiry Rules
- If `quote_expires_at` elapses before acceptance, job transitions to `expired`.
- If no `payment_tx_hash` is provided within the accept-to-payment TTL, job transitions to `expired`.
- Once `expired`, the job is terminal and cannot be modified.
