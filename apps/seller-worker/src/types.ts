export type Job = {
  job_id: string;
  status: string;
  request_payload: unknown;
  quote_amount_raw: string | null;
  quote_invoice_address: string | null;
  quote_expires_at: string | null;
  payment_tx_hash: string | null;
  lock_owner: string | null;
  lock_expires_at: string | null;
  updated_at: string;
};
