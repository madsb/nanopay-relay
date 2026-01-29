import type { Generated } from 'kysely';

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
  offer_id: Generated<string>;
  seller_pubkey: string;
  title: string;
  description: string;
  tags: string[];
  pricing_mode: PricingMode;
  fixed_price_raw: string | null;
  active: boolean;
  created_at: Generated<Date>;
}

export interface JobTable {
  job_id: Generated<string>;
  offer_id: string;
  seller_pubkey: string;
  buyer_pubkey: string;
  status: JobStatus;
  request_payload: unknown;
  quote_amount_raw: string | null;
  quote_invoice_address: string | null;
  quote_expires_at: Date | null;
  payment_tx_hash: string | null;
  lock_owner: string | null;
  lock_expires_at: Date | null;
  result_payload: unknown | null;
  error: unknown | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuthNonceTable {
  pubkey: string;
  nonce_hash: string;
  expires_at: Date;
}

export interface Database {
  offers: OfferTable;
  jobs: JobTable;
  auth_nonces: AuthNonceTable;
}
