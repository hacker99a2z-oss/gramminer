# Gram Miner

Gram Miner is a Telegram Mini App built with TanStack Start, React, TypeScript, Supabase PostgreSQL, AdsGram, and TON Connect.

## Development

Requires Node.js 22.18 or newer.

```sh
npm install
npm run dev
```

Run the existing tests with `npm test` and create a production frontend build with `npm run build`.

## Deployment

The repository is configured for a split deployment:

- **Vercel:** TanStack Start frontend and SSR.
- **Render:** standalone backend API (`backend/server.ts`).
- **Supabase:** existing PostgreSQL database, RLS policies, and atomic `gm_*` SQL functions.

Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete deployment steps and required environment variables. Never commit real `.env` files, Supabase service-role keys, Telegram connector keys, AdsGram secrets, payout cron secrets, or TON wallet mnemonics.

The database is intentionally kept on Supabase. Migrating the current PostgreSQL schema and SECURITY DEFINER balance/payout functions to MongoDB would require a separate transactional rewrite and is not part of this deployment split.
