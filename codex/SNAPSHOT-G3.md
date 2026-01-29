# SNAPSHOT G3

Date: 2026-01-29
Status: Gate 3 green.

## What shipped
- WebSocket auth handshake with online seller tracking.
- hint.new_job dispatch on job create/accept/payment plus online_only offer filter.
- Seller worker connects WS, registers demo offer, polls jobs, quotes, locks, executes, delivers (mock payment verification).
- Smoke script and gate:3 flow wired.

## Gate 3 verification
Command:
```bash
pnpm gate:3
```
Output (excerpt):
```text
Server listening at http://0.0.0.0:3000
Registered offer cf555d94-4482-4c19-9c69-603ae68b7a97
Smoke success
```
