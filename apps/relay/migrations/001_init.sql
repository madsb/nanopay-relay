-- migrate:up
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE pricing_mode_enum AS ENUM ('fixed', 'quote');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE job_status_enum AS ENUM (
    'requested',
    'quoted',
    'accepted',
    'running',
    'delivered',
    'failed',
    'canceled',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS offers (
  offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_pubkey text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  pricing_mode pricing_mode_enum NOT NULL,
  fixed_price_raw text NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_pricing_mode_check CHECK (
    (pricing_mode = 'fixed' AND fixed_price_raw IS NOT NULL) OR
    (pricing_mode = 'quote' AND fixed_price_raw IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_offers_seller_pubkey ON offers (seller_pubkey);
CREATE INDEX IF NOT EXISTS idx_offers_active ON offers (active);
CREATE INDEX IF NOT EXISTS idx_offers_pricing_mode ON offers (pricing_mode);
CREATE INDEX IF NOT EXISTS idx_offers_created_at_desc ON offers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_tags_gin ON offers USING GIN (tags);

CREATE TABLE IF NOT EXISTS jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers(offer_id) ON DELETE RESTRICT,
  seller_pubkey text NOT NULL,
  buyer_pubkey text NOT NULL,
  status job_status_enum NOT NULL DEFAULT 'requested',
  request_payload jsonb NOT NULL,
  quote_amount_raw text NULL,
  quote_invoice_address text NULL,
  quote_expires_at timestamptz NULL,
  payment_tx_hash text NULL,
  lock_owner text NULL,
  lock_expires_at timestamptz NULL,
  result_payload jsonb NULL,
  error jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_quote_required CHECK (
    status NOT IN ('quoted','accepted','running','delivered','failed') OR
    (quote_amount_raw IS NOT NULL AND quote_invoice_address IS NOT NULL)
  ),
  CONSTRAINT jobs_payment_required CHECK (
    status NOT IN ('running','delivered','failed') OR
    payment_tx_hash IS NOT NULL
  ),
  CONSTRAINT jobs_delivered_payload CHECK (
    status <> 'delivered' OR (result_payload IS NOT NULL AND error IS NULL)
  ),
  CONSTRAINT jobs_failed_payload CHECK (
    status <> 'failed' OR (error IS NOT NULL AND result_payload IS NULL)
  ),
  CONSTRAINT jobs_terminal_payload CHECK (
    status NOT IN ('canceled','expired') OR (result_payload IS NULL AND error IS NULL)
  ),
  CONSTRAINT jobs_lock_requires_expiry CHECK (
    lock_owner IS NULL OR lock_expires_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_jobs_offer_id ON jobs (offer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_seller_status_updated ON jobs (seller_pubkey, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_buyer_status_updated ON jobs (buyer_pubkey, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_quote_expires_at ON jobs (quote_expires_at) WHERE status = 'quoted';
CREATE INDEX IF NOT EXISTS idx_jobs_lock_expires_at ON jobs (lock_expires_at) WHERE lock_owner IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_nonces (
  pubkey text NOT NULL,
  nonce_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (pubkey, nonce_hash)
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires_at ON auth_nonces (expires_at);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- migrate:down
DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
DROP FUNCTION IF EXISTS set_updated_at;
DROP TABLE IF EXISTS auth_nonces;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS offers;
DROP TYPE IF EXISTS job_status_enum;
DROP TYPE IF EXISTS pricing_mode_enum;
