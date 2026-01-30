-- migrate:up
create table if not exists idempotency_keys (
  pubkey text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer null,
  response_body jsonb null,
  created_at timestamptz not null default now(),
  primary key (pubkey, idempotency_key)
);

create index if not exists idx_idempotency_created_at on idempotency_keys (created_at);

-- migrate:down
drop table if exists idempotency_keys;
