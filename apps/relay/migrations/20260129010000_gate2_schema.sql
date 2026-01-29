-- migrate:up
create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pricing_mode_enum') then
    create type pricing_mode_enum as enum ('fixed', 'quote');
  end if;
  if not exists (select 1 from pg_type where typname = 'job_status_enum') then
    create type job_status_enum as enum (
      'requested',
      'quoted',
      'accepted',
      'running',
      'delivered',
      'failed',
      'canceled',
      'expired'
    );
  end if;
end $$;

create table if not exists offers (
  offer_id uuid primary key default gen_random_uuid(),
  seller_pubkey text not null,
  title text not null,
  description text not null,
  tags text[] not null default '{}',
  pricing_mode pricing_mode_enum not null,
  fixed_price_raw text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint offers_fixed_price check (
    (pricing_mode = 'fixed' and fixed_price_raw is not null)
    or (pricing_mode = 'quote' and fixed_price_raw is null)
  )
);

create table if not exists jobs (
  job_id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(offer_id) on delete restrict,
  seller_pubkey text not null,
  buyer_pubkey text not null,
  status job_status_enum not null default 'requested',
  request_payload jsonb not null,
  quote_amount_raw text null,
  quote_invoice_address text null,
  quote_expires_at timestamptz null,
  payment_tx_hash text null,
  lock_owner text null,
  lock_expires_at timestamptz null,
  result_payload jsonb null,
  error jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_quote_required check (
    status in ('requested', 'canceled', 'expired')
    or (quote_amount_raw is not null and quote_invoice_address is not null)
  ),
  constraint jobs_payment_required check (
    status in ('requested', 'quoted', 'accepted', 'canceled', 'expired')
    or payment_tx_hash is not null
  ),
  constraint jobs_delivered_result check (
    status <> 'delivered'
    or (result_payload is not null and error is null)
  ),
  constraint jobs_failed_error check (
    status <> 'failed' or error is not null
  ),
  constraint jobs_terminal_clear check (
    status not in ('canceled', 'expired')
    or (result_payload is null and error is null)
  ),
  constraint jobs_lock_requires_expiry check (
    lock_owner is null or lock_expires_at is not null
  )
);

create table if not exists nonces (
  pubkey text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  primary key (pubkey, nonce)
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_jobs_updated_at on jobs;
create trigger set_jobs_updated_at
before update on jobs
for each row execute function set_updated_at();

create index if not exists idx_offers_seller_pubkey on offers (seller_pubkey);
create index if not exists idx_offers_active on offers (active);
create index if not exists idx_offers_pricing_mode on offers (pricing_mode);
create index if not exists idx_offers_created_at_desc on offers (created_at desc);
create index if not exists idx_offers_tags_gin on offers using gin (tags);

create index if not exists idx_jobs_offer_id on jobs (offer_id);
create index if not exists idx_jobs_seller_status_updated on jobs (seller_pubkey, status, updated_at desc);
create index if not exists idx_jobs_buyer_status_updated on jobs (buyer_pubkey, status, updated_at desc);
create index if not exists idx_jobs_status on jobs (status);
create index if not exists idx_jobs_quote_expires_at on jobs (quote_expires_at) where status = 'quoted';
create index if not exists idx_jobs_lock_expires_at on jobs (lock_expires_at) where lock_owner is not null;

-- migrate:down
drop trigger if exists set_jobs_updated_at on jobs;
drop function if exists set_updated_at;
drop table if exists nonces;
drop table if exists jobs;
drop table if exists offers;
drop type if exists job_status_enum;
drop type if exists pricing_mode_enum;
