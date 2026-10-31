# Gram Miner

Gram Miner is a Telegram Mini App built with React, TanStack Start, TypeScript, Cloudflare Pages/CDN, Cloudflare Workers, Turso/libSQL, AdsGram, and TON Connect.

## Production architecture

- **Cloudflare Pages/CDN** — serves the frontend app and static assets.
- **Cloudflare Workers** — public game API, Telegram Mini App authentication, server-side game rules, and public leaderboard edge caching.
- **Render** — Node service for Telegram Bot webhook handling, TON payout signing/batching, payout confirmation, and payment-proof messages.
- **Turso** — the single authoritative database for user coins, withdrawable balances, miners, referrals, ad sessions, withdrawals, and payout records.

The browser never decides balances or reward amounts. Gameplay actions are server-validated and committed to Turso. Render remains separate from the public game API and must retain wallet signing secrets; never expose these in frontend code or Cloudflare Pages variables.

## Repository structure

- `frontend/` — browser UI, pages/routes, React components, Telegram WebApp helper, AdsGram client and TON Connect UI.
- `backend/worker.ts` — Cloudflare Workers public game API.
- `backend/server.ts` — Render Node service for Telegram webhook and payout processing.
- `backend/lib/` — shared game rules, Telegram authentication, and Turso database operations.
- `backend/turso/schema.sql` — Turso/libSQL schema.
- `render.yaml` — existing Render web service Blueprint.
- `wrangler.jsonc` — Cloudflare Worker configuration.

## Local development

Requires Node.js 22.18 or newer.

Frontend:
```sh
cd frontend
npm install
npm run dev
```

Worker/API dependencies, from repository root:
```sh
npm install
npm run dev:worker
```

Render Node service, from repository root:
```sh
npm install
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run start:api
```

## Deployment

- [Cloudflare Pages, Workers, cache rules, and API routing](./CLOUDFLARE_WORKERS.md)
- [Render service setup, environment variables, Telegram webhook, and payout settings](./RENDER_SETUP.md)
- [Step-by-step staging and production cutover checklist](./PRODUCTION_CUTOVER_CHECKLIST.md)
- [Deployment overview](./DEPLOYMENT.md)

Never commit `.env` files, Turso tokens, database passwords, bot tokens, callback secrets, payout secrets, or wallet mnemonics.
