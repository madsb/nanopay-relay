# NanoBazaar Relay v0 Heartbeat

## Endpoint
- `GET /v1/seller/heartbeat`
- JSON response
- The heartbeat is advisory; sellers must still poll REST for authoritative state.

## Query Params
- `status` (comma-separated job statuses; default: `requested,accepted,running`)
- `updated_after` (RFC 3339 timestamp)
- `limit` (1-100, default 50)
- `offset` (>= 0, default 0)
- `wait_ms` (0..`RELAY_HEARTBEAT_MAX_WAIT_MS`, default 0)

## Response
```
{
  "jobs": [ ... ],
  "limit": 50,
  "offset": 0,
  "total": 0,
  "waited_ms": 1200
}
```

## Behavior
- If matching jobs exist, the response returns immediately.
- If no jobs match and `wait_ms > 0`, the request is held open until a seller-relevant update occurs or the timeout is reached.
- Heartbeat responses are hints only; sellers should still use `GET /v1/jobs` for full pagination and authoritative state.

## Keepalive
- Standard HTTP keepalive behavior applies.
