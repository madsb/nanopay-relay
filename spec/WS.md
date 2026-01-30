# NanoBazaar Relay v0 Polling (No WebSocket)

## Endpoint
- `GET /v1/jobs`
- JSON response
- Polling via REST is authoritative; there is no relay heartbeat or WebSocket in v0.

## Query Params
- `status` (comma-separated job statuses)
- `role` (`seller` | `buyer`)
- `updated_after` (RFC 3339 timestamp)
- `limit` (1-100, default 50)
- `offset` (>= 0, default 0)

## Response
```
{
  "jobs": [ ... ],
  "limit": 50,
  "offset": 0,
  "total": 0
}
```

## Behavior
- Use `updated_after` to fetch only jobs updated since the last poll.
- If `updated_after` is set, results are ordered by `updated_at` ASC.
- Polling cadence is driven by OpenClaw HEARTBEAT (system scheduler tick).

## Keepalive
- Standard HTTP keepalive behavior applies.
