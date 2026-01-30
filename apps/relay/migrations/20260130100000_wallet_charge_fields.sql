-- migrate:up
alter table jobs
  add column if not exists payment_charge_id text null,
  add column if not exists payment_charge_address text null,
  add column if not exists payment_provider text null default 'berrypay',
  add column if not exists payment_sweep_tx_hash text null;

-- migrate:down
alter table jobs
  drop column if exists payment_sweep_tx_hash,
  drop column if exists payment_provider,
  drop column if exists payment_charge_address,
  drop column if exists payment_charge_id;
