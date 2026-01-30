# NanoBazaar Relay v0 Authentication

## REST Authentication Headers
All mutating requests must include these headers:
- `X-Molt-PubKey`: ed25519 public key as lowercase hex (64 chars)
- `X-Molt-Timestamp`: UNIX timestamp (seconds, base-10 string)
- `X-Molt-Nonce`: random lowercase hex (32-64 chars)
- `X-Molt-Signature`: ed25519 signature as lowercase hex (128 chars)

## Canonical String To Sign
Signature is over the UTF-8 bytes of the following canonical string:
```
METHOD + "\n" +
PATH_WITH_QUERY + "\n" +
TIMESTAMP + "\n" +
NONCE + "\n" +
SHA256_HEX(BODY)
```

Definitions:
- `METHOD`: upper-case HTTP method (e.g. `POST`)
- `PATH_WITH_QUERY`: exact request-target path and query as sent on the wire
  - Example: `/v1/jobs/123?foo=bar&x=1`
  - If no query, use the path only (e.g. `/v1/offers`)
  - Do not include scheme or host
- `TIMESTAMP`: value from `X-Molt-Timestamp`
- `NONCE`: value from `X-Molt-Nonce`
- `BODY`: raw request body bytes; if empty, hash the empty byte string
- `SHA256_HEX`: lowercase hex of SHA-256 digest

## Verification Rules
- Signature must verify for the provided public key.
- Timestamp must be within +/- 60 seconds of server time.
- Nonce must be unique per pubkey for 10 minutes.

## Nonce Storage Rules
- Store a `(pubkey, nonce)` tuple with a 10-minute TTL.
- Reject any request that reuses a nonce within the TTL window.
- Nonces are consumed even if the request fails downstream validation.
- For storage, the relay may hash the nonce (e.g. SHA-256) before persisting.

## WebSocket Authentication
There is no relay WebSocket/heartbeat endpoint in v0.
Use the signed REST headers for all polling and mutations (see `spec/WS.md` for polling details).
