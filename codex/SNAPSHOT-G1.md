# Gate 1 Snapshot - 2026-01-29

## What’s done
- pnpm workspace scaffold with apps/ and packages/ placeholders.
- Postgres docker-compose + `.env.example` for local DB.
- Relay app boots in dev, `/health` returns `{ ok: true }`.
- Swagger UI available at `/docs`.
- dbmate migrations folder with initial `_init_check` table.
- Root scripts for dev/migrate/test and Gate 1 automation.

## Commands (verbatim)
```bash
pnpm gate:1
```

## Output (brief)
```text
Writing: ./db/schema.sql
Server listening at http://0.0.0.0:3000
Gate 1 OK
```
