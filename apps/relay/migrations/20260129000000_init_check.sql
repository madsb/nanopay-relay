-- migrate:up
create table if not exists _init_check (
  id bigserial primary key,
  created_at timestamptz not null default now()
);

-- migrate:down
drop table if exists _init_check;
