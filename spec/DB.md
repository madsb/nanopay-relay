# NanoBazaar Relay v0 Database

Target DB: PostgreSQL 14+

## Enums
```
pricing_mode_enum = ('fixed', 'quote')
job_status_enum   = ('requested', 'quoted', 'accepted', 'running', 'delivered', 'failed', 'canceled', 'expired')
```

## Table: offers

Columns:
- `offer_id` uuid pk, default `gen_random_uuid()`
- `seller_pubkey` text not null
- `title` text not null
- `description` text not null
- `tags` text[] not null default '{}'
- `pricing_mode` pricing_mode_enum not null
- `fixed_price_raw` text null
- `active` boolean not null default true
- `created_at` timestamptz not null default now()

Constraints:
- `pricing_mode = 'fixed'` requires `fixed_price_raw` not null
- `pricing_mode = 'quote'` requires `fixed_price_raw` null

Indexes:
- pk: `offers_pkey (offer_id)`
- `idx_offers_seller_pubkey (seller_pubkey)`
- `idx_offers_active (active)`
- `idx_offers_pricing_mode (pricing_mode)`
- `idx_offers_created_at_desc (created_at DESC)`
- `idx_offers_tags_gin (GIN(tags))`

## Table: jobs

Columns:
- `job_id` uuid pk, default `gen_random_uuid()`
- `offer_id` uuid not null references `offers(offer_id)` on delete restrict
- `seller_pubkey` text not null
- `buyer_pubkey` text not null
- `status` job_status_enum not null default 'requested'
- `request_payload` jsonb not null
- `quote_amount_raw` text null
- `quote_invoice_address` text null
- `quote_expires_at` timestamptz null
- `payment_tx_hash` text null
- `payment_charge_id` text null
- `payment_charge_address` text null
- `payment_provider` text null default 'berrypay'
- `payment_sweep_tx_hash` text null
- `lock_owner` text null
- `lock_expires_at` timestamptz null
- `result_url` text null
- `result_payload` jsonb null (deprecated; always null)
- `error` jsonb null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Constraints:
- If `status` in ('quoted','accepted','running','delivered','failed') then `quote_amount_raw` and `quote_invoice_address` must be not null
- If `status` in ('running','delivered','failed') then `payment_tx_hash` must be not null
- If `status` = 'delivered' then `result_url` not null and `error` is null
- If `status` = 'failed' then `error` not null and `result_url` is null
- If `status` in ('canceled','expired') then `result_url` is null and `error` is null
- If `lock_owner` is not null then `lock_expires_at` is not null

Indexes:
- pk: `jobs_pkey (job_id)`
- `idx_jobs_offer_id (offer_id)`
- `idx_jobs_seller_status_updated (seller_pubkey, status, updated_at DESC)`
- `idx_jobs_buyer_status_updated (buyer_pubkey, status, updated_at DESC)`
- `idx_jobs_status (status)`
- `idx_jobs_quote_expires_at (quote_expires_at) WHERE status = 'quoted'`
- `idx_jobs_lock_expires_at (lock_expires_at) WHERE lock_owner IS NOT NULL`

Other:
- Maintain `updated_at` via a trigger on update.
