# Gram Miner

Gram Miner is a Telegram Mini App built with React, TanStack Start, TypeScript, Turso/libSQL, AdsGram, and TON Connect.

## Repository structure

- `frontend/` — browser UI, pages/routes, React components, Telegram WebApp helper, AdsGram client and TON Connect UI.
- `backend/` — standalone Node.js API, game rules, Turso database operations, Telegram Bot API integration and TON payouts.
- `backend/turso/schema.sql` — Turso database schema.
- `scripts/migrate-supabase-to-turso.mjs` — one-time importer for existing Supabase PostgreSQL data.
- Root `package.json` — backend dependencies and Render start/migration scripts.

Lovable is not used by builds, runtime, API calls, error reporting, authentication or Telegram integration. Runtime game data is stored in Turso; Supabase is only a source for the optional one-time migration.

## Local development

Requires Node.js 22.18 or newer.

Frontend:
```sh
cd frontend
npm install
npm run dev
```

Backend, from repository root:
```sh
npm install
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run start:api
```

## Deployment

- Vercel Root Directory: `frontend`
- Render Root Directory: repository root
- Render backend environment: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and the Telegram/AdsGram/TON secrets.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Turso setup, data migration and environment variables. Never commit `.env` files, Turso tokens, database passwords, bot tokens, callback secrets or wallet mnemonics.
