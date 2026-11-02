# Gram Miner

Gram Miner is a Telegram Mini App built with React, TanStack Router, TypeScript, Turso/libSQL, AdsGram and TON Connect.

## Repository structure

- frontend/ — static React SPA, routes, UI components, Telegram WebApp helper, AdsGram client and TON Connect UI.
- backend/ — standalone Node.js API, game rules, Turso database operations, Telegram Bot API integration and scheduled TON payout worker.
- backend/turso/schema.sql — fresh-install database schema.
- scripts/migrate-supabase-to-turso.mjs — one-time importer for existing Supabase PostgreSQL data.
- Root package.json — backend dependencies and scripts.

## Local development

Requires Node.js 22.18 or newer.

Frontend:
    cd frontend
    npm install --legacy-peer-deps
    npm run dev

Backend, from repository root:
    npm install
    TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run start:api

Run backend verification:
    npm run typecheck
    npm test

See DEPLOYMENT.md for deployment, migration, AdsGram callback limitations and payout cron configuration. Never commit .env files, database credentials, bot tokens, callback secrets or wallet mnemonics.
