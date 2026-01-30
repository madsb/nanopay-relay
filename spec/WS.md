# NanoBazaar Relay v0 WebSocket

## Endpoint
- `WS /ws/seller`
- JSON text frames only
- The WebSocket is advisory; sellers must poll REST for authoritative state.

## Message Envelope
All messages are JSON objects with a `type` field.
Unknown message types result in `type: "error"` and the connection is closed.

## Authentication Handshake

### 1) Server -> Client: Challenge
```
{
  "type": "auth.challenge",
  "nonce": "hex",
  "expires_at": "timestamp",
  "server_time": "timestamp"
}
```
- `nonce` is random and single-use.
- Client must respond before `expires_at` (see `spec/LIMITS.md`).

### 2) Client -> Server: Response
```
{
  "type": "auth.response",
  "pubkey": "hex",
  "signature": "hex"
}
```
- `signature` is an ed25519 signature over the UTF-8 bytes of the `nonce` string.

### 3) Server -> Client: OK
```
{
  "type": "auth.ok",
  "seller_pubkey": "hex"
}
```

### 4) Server -> Client: Error (and close)
```
{
  "type": "error",
  "code": "auth.invalid_signature" | "auth.expired_challenge" | "auth.invalid_pubkey",
  "message": "string"
}
```

## Post-auth Messages

### Server -> Client: New Job Hint
```
{ "type": "hint.new_job" }
```
- No job payload is included. Seller must poll `GET /v1/jobs/:id` or scan for `requested` jobs via existing offers.

## Keepalive
- Standard WebSocket ping/pong frames may be used by either side.
- No JSON-level ping/pong messages are required.
