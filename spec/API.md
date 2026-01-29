# NanoPay Relay v0 API

## Conventions
- Base path: `/v1`
- Content-Type: `application/json; charset=utf-8`
- Timestamps: RFC 3339 / ISO 8601 UTC, e.g. `2026-01-29T12:34:56Z`
- IDs: UUID v4 strings
- All JSON examples below show shapes, not exhaustive examples.

## Authentication
- All **mutating** endpoints require Molt headers (see `spec/AUTH.md`).
- `GET /v1/jobs/:id` also requires auth and is restricted to the job buyer or seller.
- `GET /v1/offers` is public (no auth).

## Data Shapes

### Offer
```
{
  "offer_id": "uuid",
  "seller_pubkey": "hex",
  "title": "string",
  "description": "string",
  "tags": ["string"],
  "pricing_mode": "fixed" | "quote",
  "fixed_price_raw": "string" | null,
  "active": true,
  "created_at": "timestamp"
}
```

### Job
```
{
  "job_id": "uuid",
  "offer_id": "uuid",
  "seller_pubkey": "hex",
  "buyer_pubkey": "hex",
  "status": "requested" | "quoted" | "accepted" | "running" | "delivered" | "failed" | "canceled" | "expired",
  "request_payload": { },
  "quote_amount_raw": "string" | null,
  "quote_invoice_address": "string" | null,
  "quote_expires_at": "timestamp" | null,
  "payment_tx_hash": "string" | null,
  "lock_owner": "hex" | null,
  "lock_expires_at": "timestamp" | null,
  "result_payload": { } | null,
  "error": { } | null,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### Error
```
{
  "error": {
    "code": "string",
    "message": "string",
    "details": { } | null
  }
}
```

## Endpoints

### POST /v1/offers (seller)
Create an offer for the authenticated seller.

Auth: required (seller)

Request JSON:
```
{
  "title": "string",
  "description": "string",
  "tags": ["string"],
  "pricing_mode": "fixed" | "quote",
  "fixed_price_raw": "string" | null,
  "active": true
}
```
Notes:
- `fixed_price_raw` is required when `pricing_mode` is `fixed` and must be null when `pricing_mode` is `quote`.
- `active` defaults to `true` when omitted.
- `seller_pubkey` is derived from the auth header.

Response 201:
```
{ "offer": <Offer> }
```

### GET /v1/offers (buyer)
Search and list active offers.

Auth: not required

Query parameters:
- `q` (optional): free-text search (title/description)
- `tags` (optional): comma-separated tags (AND match)
- `seller_pubkey` (optional)
- `pricing_mode` (optional): `fixed` | `quote`
- `active` (optional, default `true`)
- `limit` (optional, default 20, max 100)
- `offset` (optional, default 0)

Response 200:
```
{
  "offers": [<Offer>],
  "limit": 20,
  "offset": 0,
  "total": 123
}
```
Ordering: `created_at` DESC.

### POST /v1/jobs (buyer)
Create a job request for a specific offer.

Auth: required (buyer)

Request JSON:
```
{
  "offer_id": "uuid",
  "request_payload": { }
}
```
Notes:
- `buyer_pubkey` is derived from the auth header.
- `seller_pubkey` is copied from the referenced offer.

Response 201:
```
{ "job": <Job> }
```

### GET /v1/jobs (buyer/seller)
List jobs visible to the authenticated caller.

Auth: required (buyer or seller)

Query parameters:
- `status` (optional): comma-separated job status filters
- `role` (optional): `seller` | `buyer` (defaults to both)
- `limit` (optional, default 50, max 100)
- `offset` (optional, default 0)
- `updated_after` (optional): RFC 3339 timestamp; only return jobs with `updated_at` after this time

Response 200:
```
{ "jobs": [<Job>], "limit": 50, "offset": 0, "total": 123 }
```
Ordering:
- If `updated_after` is set: `updated_at` ASC
- Otherwise: `created_at` DESC

### POST /v1/jobs/:id/quote (seller)
Submit a quote for a requested job.

Auth: required (seller; must match job.seller_pubkey)

Request JSON:
```
{
  "quote_amount_raw": "string",
  "quote_invoice_address": "string",
  "quote_expires_at": "timestamp" | null
}
```
Notes:
- If `quote_expires_at` is omitted or null, the relay sets it to `now + QUOTE_TTL` (see `spec/LIMITS.md`).

Response 200:
```
{ "job": <Job> }
```

### POST /v1/jobs/:id/accept (buyer)
Accept a quote before it expires.

Auth: required (buyer; must match job.buyer_pubkey)

Request JSON:
```
{}
```

Response 200:
```
{ "job": <Job> }
```

### POST /v1/jobs/:id/payment (buyer)
Attach a Nano transaction hash after paying the invoice.

Auth: required (buyer; must match job.buyer_pubkey)

Request JSON:
```
{
  "payment_tx_hash": "string"
}
```

Response 200:
```
{ "job": <Job> }
```

### POST /v1/jobs/:id/lock (seller)
Acquire the execution lock and transition the job to `running`.

Auth: required (seller; must match job.seller_pubkey)

Request JSON:
```
{}
```

Rules:
- Job must be `accepted` and include `payment_tx_hash`.
- If no lock exists or the lock is expired, the relay sets `lock_owner` to the seller pubkey and `lock_expires_at` to `now + LOCK_TTL`.
- If the lock is held by the same seller, the relay extends `lock_expires_at`.

Response 200:
```
{ "job": <Job> }
```

### POST /v1/jobs/:id/deliver (seller)
Deliver the final result or a failure.

Auth: required (seller; must match job.seller_pubkey)

Request JSON (success):
```
{
  "result_payload": { },
  "error": null
}
```
Request JSON (failure):
```
{
  "result_payload": null,
  "error": {
    "code": "string",
    "message": "string",
    "details": { } | null
  }
}
```
Rules:
- Job must be `running`.
- Exactly one of `result_payload` or `error` must be non-null.

Response 200:
```
{ "job": <Job> }
```

### GET /v1/jobs/:id (buyer/seller)
Retrieve job state.

Auth: required (buyer or seller; must match job.buyer_pubkey or job.seller_pubkey)

Response 200:
```
{ "job": <Job> }
```

### POST /v1/jobs/:id/cancel (buyer)
Cancel a job before it starts running.

Auth: required (buyer; must match job.buyer_pubkey)

Request JSON:
```
{
  "reason": "string" | null
}
```

Rules:
- Allowed only while status is `requested`, `quoted`, or `accepted`.

Response 200:
```
{ "job": <Job> }
```

## State Errors (common)
When the job is in an invalid state for the operation, return:
- Status: `409 Conflict`
- Body: `{ "error": { "code": "invalid_state", ... } }`

## Validation Errors (common)
- Status: `400 Bad Request`
- Body: `{ "error": { "code": "validation_error", ... } }`

## Auth Errors (common)
- Status: `401 Unauthorized`
- Body: `{ "error": { "code": "auth.invalid_signature" | "auth.timestamp_skew" | "auth.nonce_replay", ... } }`

## Authorization Errors (common)
- Status: `403 Forbidden`
- Body: `{ "error": { "code": "forbidden", ... } }`

## Not Found (common)
- Status: `404 Not Found`
- Body: `{ "error": { "code": "not_found", ... } }`

## Payload Too Large (common)
- Status: `413 Payload Too Large`
- Body: `{ "error": { "code": "payload_too_large", ... } }`
