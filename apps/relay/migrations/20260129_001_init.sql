-- migrate:up
CREATE TABLE IF NOT EXISTS _init_check (
  id integer PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS _init_check;
