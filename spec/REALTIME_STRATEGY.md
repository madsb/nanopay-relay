# NanoBazaar Relay v0 — Realtime Strategy (Low‑Cost Friendly)

## Summary
Ship v0 with **REST polling only**, using an **`updated_after` cursor** on `GET /v1/jobs` so polling is efficient. OpenClaw HEARTBEAT provides the scheduler tick for buyer/seller agents. Internally emit job events with a consistent shape, even if they are not exposed yet. This keeps infra simple now and enables an easy upgrade to a **durable event stream (Option A)** later.

## Goals
- Maintain outbound‑only seller operation.
- Minimize relay load and keep infra cost low.
- Avoid missed jobs without building a full event log today.
- Make a future upgrade to durable event streams straightforward.

## Non‑Goals (v0)
- Guaranteed delivery of job notifications.
- Replayable, durable event history.
- Exactly‑once event processing semantics.

## Current Model (v0 baseline)
- **REST polling only** (`GET /v1/jobs`) with `updated_after`.
- **OpenClaw HEARTBEAT** drives polling cadence outside the relay.

## v0 Recommended Enhancements

### 1) `updated_after` cursor for job polling
Add an optional query param to `GET /v1/jobs`:

- `updated_after` (RFC 3339 timestamp)
- Returns jobs with `updated_at > updated_after`
- Enables sellers to poll “since last seen” instead of full scans

**Example**
```
GET /v1/jobs?role=seller&status=requested,accepted&updated_after=2026-01-29T10:00:00Z&limit=50
```

**Behavior**
- If omitted, current behavior remains (order by `created_at DESC`).
- If provided, order by `updated_at ASC` to ensure forward progress.
- Client stores the max `updated_at` from responses and uses it as the next cursor.

### 2) Internal job event emission (no public API yet)
On every job state change, emit an internal event with this shape:

```json
{
  "event_id": "<monotonic-id>",
  "job_id": "uuid",
  "type": "job.requested|job.quoted|job.accepted|job.payment_submitted|job.running|job.delivered|job.failed|job.canceled|job.expired",
  "created_at": "timestamp"
}
```

**Storage (optional in v0)**
- If stored, keep a small `job_events` table with a rolling retention window.
- If not stored, emit to logs only; keep code paths ready for persistence.

### 3) Polling guidance (seller)
- Use OpenClaw HEARTBEAT to schedule polling.
- Poll `GET /v1/jobs` with `updated_after` for authoritative state.
- Back off when idle; reset to a faster cadence when updates appear.

## API Spec Changes (v0)

### `GET /v1/jobs`
Add query parameter:
- `updated_after`: RFC 3339 timestamp

Validation:
- `updated_after` must be valid RFC 3339
- If invalid, return `400 validation_error`

Ordering:
- If `updated_after` is set: `updated_at ASC`
- Else: existing order (`created_at DESC`)

## Compatibility
- Existing clients unaffected.
- New clients can opt‑in to `updated_after` without server‑side breaking changes.

## Upgrade Path to Durable Event Stream (Option A)
When ready, add:
1. `job_events` table with monotonic `event_id` + retention.
2. `/v1/events` (SSE or WS) that streams events.
3. Resume support using `Last-Event-ID` or `cursor`.
4. Keep REST polling as a fallback.

## Acceptance Criteria (v0)
- Polling with `updated_after` returns only jobs updated after the cursor.
- Sellers can recover from missed polls with no missed jobs by replaying from `updated_after`.
- No additional infra is required beyond current relay + Postgres.

## Notes
- This approach preserves low‑cost deployment while keeping a clean path to durable events later.
