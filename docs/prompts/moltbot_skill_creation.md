You are a senior PM/architect. Create a detailed spec for the remaining work on NanoBazaar Relay v0.
Assume the relay core is already implemented in the repo madsb/nanobazaar-relay (dev branch), with specs in:

• spec/PRD.md
• spec/API.md
• spec/AUTH.md
• spec/WS.md (heartbeat)
• spec/LIMITS.md
• spec/DB.md

Documentation for creating a Moltbot/Clawcode skill is in:
docs/MOLTBOT_SKILL.md

What exists already (context you must use):

• Relay REST API + /v1/seller/heartbeat (advisory)
• ed25519 request signing for mutating endpoints
• DB schema + migrations for offers/jobs/auth_nonces
• Seller demo worker (currently mock payment verification)
• Gate scripts + basic tests
What’s missing (you must spec):

1. Moltbot/Clawcode skills for buyer and seller flows
2. Real Nano wallet handling (invoice address generation, payment verification, key management)
3. Integration patterns for seller worker running outbound-only (no open ports)
4. Any remaining hardening for production readiness (rate limits, idempotency, observability, etc.)
Constraints (non‑negotiable):

• Payments are peer‑to‑peer Nano; relay never holds or verifies funds.
• Seller verifies payment.
• Sellers should not open inbound ports; they connect outbound (heartbeat + REST polling).
• Keep API‑first. No UI requirements.
• Use nanocurrency-js for wallet primitives; use Nano RPC for payment verification.

Output format (markdown)

1) Current State Summary (short, to prove you understood)

2) Remaining Scope
Break into: Buyer skill, Seller skill/worker, Wallet, Ops/Hardening

3) Requirements & Flows

• Buyer flow: search → request → accept → pay → submit tx hash → receive result
• Seller flow: quote → verify → lock → execute → deliver
• Show message/sequence diagrams or step lists.
4) Wallet + Payment Verification Spec

• Key/seed storage options (default + alternatives)
• Invoice address generation per job
• Nano RPC calls (what endpoints, what checks)
• Replay/nonce/tx reuse mitigation
5) Skill API Design
Define concrete command/tool surfaces for buyer + seller skills, e.g.

• nanobazaar-relay.search_offers(...)
• nanobazaar-relay.request_job(...)
• nanobazaar-relay.submit_payment(...)
• nanobazaar-relay.deliver_result(...)
Include expected inputs/outputs and error codes.
6) Data Models / Config

• Wallet config env vars
• Seller offer config
• Buyer skill config
• Example .env and skill config snippets
7) Security & Abuse Controls

• Rate limits or quotas
• Idempotency requirements
• Replay protection across job mutations
• Failure modes + retries
8) Testing Plan
Unit/integration tests + mocks for Nano RPC

9) Milestones
Time‑boxed plan with dependencies and acceptance criteria

10) Open Questions
What needs product decisions?
