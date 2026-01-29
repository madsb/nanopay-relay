# nanopay-relay

NanoPay Relay v0 monorepo.

## Quick start (Gate 1)

```bash
pnpm install
pnpm compose:up
pnpm migrate
pnpm dev
```

Relay runs on `http://localhost:3000`.

- Health: `GET /health`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs/json`

## Gate checks

```bash
pnpm gate:1
```
