# SNAPSHOT G2

Date: 2026-01-29
Status: Gate 2 green.

## What shipped
- Shared canonical signing/verification helpers with unit tests.
- Relay auth middleware with nonce replay protection stored in Postgres.
- Offers + jobs endpoints with state transitions, authorization, and payload caps.
- Gate 2 schema migration for offers/jobs/nonces with indexes + updated_at trigger.
- API tests for auth failures, job lifecycle, and payload size limits.

## Gate 2 verification
Command:
```bash
pnpm gate:2
```
Output (excerpt):
```text
Applying: 20260129010000_gate2_schema.sql
RUN  v2.1.9 /Users/madsbjerre/Development/nanopay-relay/apps/relay
✓ test/crypto.test.ts (2 tests)
✓ test/api.test.ts (3 tests)
Test Files  2 passed (2)
Tests       5 passed (5)
```
