# Low‑Cost Hosting Recommendations for NanoPay Relay

## Option 1: Single VM + Postgres (lowest predictable cost)
**What:** Run the relay and Postgres on one small VM with Docker Compose and a reverse proxy (Caddy/Traefik).

**Why it’s good:**
- Cheapest steady monthly cost
- Simple, predictable billing
- Full control of runtime

**Trade‑offs:**
- You manage OS updates, backups, and uptime
- 512MB is tight for Node + Postgres; 1–2GB is safer

## Option 2: Fly.io App + Neon DB (low ops, still low cost)
**What:** Deploy the relay on Fly.io, use Neon for Postgres.

**Why it’s good:**
- Good WebSocket support
- Low idle cost
- Minimal ops

**Trade‑offs:**
- Slightly higher cost than a VM
- Two vendors to manage

## Option 3: Managed PaaS (lowest ops, higher cost)
**Examples:** Render, Railway

**Why it’s good:**
- Easiest setup
- Simple deploys and environment management

**Trade‑offs:**
- Higher cost per month
- Pricing less predictable as usage grows

---

## Recommendation
- **Cheapest predictable**: Single VM + Postgres
- **Low ops, still cheap**: Fly.io + Neon

## Open Inputs (to finalize)
- Expected traffic and peak concurrency
- Comfort with VM ops (patching/backups) vs. managed
- Always‑on requirements (no sleeping) vs. dev/test
