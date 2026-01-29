# Gate 2 Snapshot - 2026-01-29

## What's done
- Added ed25519 canonical signing/verification helpers in `packages/shared`.
- Implemented REST auth middleware with nonce replay protection.
- Added offers + jobs tables, constraints, and updated_at trigger.
- Implemented offers and jobs endpoints with state machine enforcement.
- Enforced payload caps and validation rules.
- Added API tests for auth failures and job lifecycle.

## Commands (verbatim)
```bash
pnpm gate:2
```

## Output (brief)
```text
Test Files  2 passed (2)
Tests       4 passed (4)
Gate 2 OK
```
