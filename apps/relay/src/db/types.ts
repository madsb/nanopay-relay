import type { ColumnType, Generated } from "kysely";
import type { JobStatus } from "../constants.js";

type JsonValue = ColumnType<unknown, unknown, unknown>;

export type PricingMode = "fixed" | "quote";

export interface OffersTable {
  offer_id: Generated<string>;
  seller_pubkey: string;
  title: string;
  description: string;
  tags: string[];
  pricing_mode: PricingMode;
  fixed_price_raw: string | null;
  active: boolean;
  created_at: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
}

export interface JobsTable {
  job_id: Generated<string>;
  offer_id: string;
  seller_pubkey: string;
  buyer_pubkey: string;
  status: JobStatus;
  request_payload: JsonValue;
  quote_amount_raw: string | null;
  quote_invoice_address: string | null;
  quote_expires_at: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  payment_tx_hash: string | null;
  lock_owner: string | null;
  lock_expires_at: ColumnType<Date | string | null, Date | string | null | undefined, Date | string | null | undefined>;
  result_payload: JsonValue | null;
  error: JsonValue | null;
  created_at: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
  updated_at: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
}

export interface AuthNoncesTable {
  pubkey: string;
  nonce_hash: string;
  created_at: ColumnType<Date | string, Date | string | undefined, Date | string | undefined>;
}

export interface Database {
  offers: OffersTable;
  jobs: JobsTable;
  auth_nonces: AuthNoncesTable;
}
