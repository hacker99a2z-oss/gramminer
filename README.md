# Gram Miner

Gram Miner is a Telegram Mini App built with React, TanStack Start, TypeScript, Supabase PostgreSQL, AdsGram, and TON Connect.

## Repository structure

- `frontend/` — complete browser UI, pages/routes, React components, Telegram WebApp client helper, AdsGram client, TON Connect client, SSR and Vercel configuration.
- `backend/` — standalone API server, game rules and database operations, Telegram Bot API integration, Supabase admin client, TON payouts, and database migrations.
- Root `package.json` — backend runtime dependencies and Render start command.
- Root `render.yaml` — Render service configuration.

Lovable is not used for builds, runtime, API calls, error reporting, authentication, or Telegram integration. Telegram Bot API requests go directly to Telegram using `TELEGRAM_BOT_TOKEN`.

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
npm run start:api
```

## Deployment

- Vercel Root Directory: `frontend`
- Render Root Directory: repository root
- Supabase PostgreSQL remains the database. Existing tables and atomic `gm_*` functions are retained.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for environment-variable instructions. Never commit real `.env` files, Supabase service-role keys, Telegram bot tokens, AdsGram secrets, payout secrets, or TON wallet mnemonics.
