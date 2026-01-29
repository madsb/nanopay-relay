# NanoPay Relay v0 - Codex Brief

Goal: implement NanoPay Relay v0 fast. This is a centralized relay that stores offers and jobs. Sellers keep an outbound WebSocket connection (no inbound ports). WS is advisory only; polling REST is source of truth. Payments happen buyer->seller in Nano; relay never verifies or holds funds. v0 uses mock payment verification in the seller worker; real Nano RPC verification is a later step.

Scope limits (v0): no URS/moderation, no reputation/feedback, no event replay/ack queues, no multi-agent composition, no streaming logs/messages, no file uploads, JSON payloads only with strict caps.

Tech stack (fixed): Node 20+ TypeScript, pnpm workspaces monorepo, Fastify + @fastify/websocket, Zod, Swagger/OpenAPI, Postgres in Docker, dbmate SQL migrations, Kysely, tweetnacl ed25519 auth, Vitest.

Repo layout: apps/relay, apps/seller-worker, packages/shared, scripts, spec, codex.
