export const LIMITS = {
  bodyMaxBytes: 300 * 1024,
  requestPayloadMaxBytes: 64 * 1024,
  resultPayloadMaxBytes: 256 * 1024,
  errorPayloadMaxBytes: 8 * 1024,
  titleMax: 120,
  descriptionMax: 2000,
  tagsMax: 16,
  tagMax: 32,
  priceMax: 40,
  invoiceMax: 128,
  paymentHashMax: 128,
  quoteTtlSeconds: 15 * 60,
  quoteTtlMaxSeconds: 60 * 60,
  paymentTtlSeconds: 30 * 60,
  lockTtlSeconds: 5 * 60,
  authSkewSeconds: 60,
  nonceTtlSeconds: 10 * 60
} as const;

export const HEADER_NAMES = {
  pubkey: "x-molt-pubkey",
  timestamp: "x-molt-timestamp",
  nonce: "x-molt-nonce",
  signature: "x-molt-signature"
} as const;

export const JOB_STATUS = {
  requested: "requested",
  quoted: "quoted",
  accepted: "accepted",
  running: "running",
  delivered: "delivered",
  failed: "failed",
  canceled: "canceled",
  expired: "expired"
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
export type PricingMode = "fixed" | "quote";
