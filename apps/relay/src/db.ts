import { Kysely, PostgresDialect, type ColumnType } from 'kysely';
import { Pool } from 'pg';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;

export type PricingMode = 'fixed' | 'quote';
export type JobStatus =
  | 'requested'
  | 'quoted'
  | 'accepted'
  | 'running'
  | 'delivered'
  | 'failed'
  | 'canceled'
  | 'expired';

export interface OfferTable {
  offer_id: string;
  seller_pubkey: string;
  title: string;
  description: string;
  tags: string[];
  pricing_mode: PricingMode;
  fixed_price_raw: string | null;
  active: boolean;
  created_at: Date;
}

export interface JobTable {
  job_id: string;
  offer_id: string;
  seller_pubkey: string;
  buyer_pubkey: string;
  status: JobStatus;
  request_payload: JsonColumn;
  quote_amount_raw: string | null;
  quote_invoice_address: string | null;
  quote_expires_at: Date | null;
  payment_tx_hash: string | null;
  lock_owner: string | null;
  lock_expires_at: Date | null;
  result_payload: JsonColumn | null;
  error: JsonColumn | null;
  created_at: Date;
  updated_at: Date;
}

export interface NonceTable {
  pubkey: string;
  nonce: string;
  created_at: Date;
}

export interface IdempotencyTable {
  pubkey: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number | null;
  response_body: JsonColumn | null;
  created_at: Date;
}

export interface Database {
  offers: OfferTable;
  jobs: JobTable;
  nonces: NonceTable;
  idempotency_keys: IdempotencyTable;
}

export const createDb = (databaseUrl: string) =>
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl })
    })
  });
