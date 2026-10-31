# Gram Miner deployment and credentials

## Architecture

- `frontend/`: static React + TanStack Router SPA. Vercel serves the built files through its CDN; it does not need a per-page SSR Function.
- `backend/`: Node.js JSON API, game logic, Turso database access, Telegram Bot API, AdsGram reward verification and TON payout processing. Runs on Render.
- `backend/turso/schema.sql`: Turso/libSQL schema.
- `scripts/migrate-supabase-to-turso.mjs`: one-time data migration.

Gameplay requests go directly from the browser to Render. Telegram Mini App `initData` remains validated on the backend. No bot token, database credential, callback secret or payout wallet phrase is exposed to the browser.

## Turso database

1. Create a Turso database in a region close to Render's Singapore region when practical.
2. Copy the database URL and create an auth token.
3. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to Render > gramminer-backend > Environment.
4. The backend initializes the required tables and indexes at startup.

Keep the original Supabase project and backup until any one-time migration to Turso has been verified. The runtime uses Turso, not Supabase.

## Render backend

Keep Root Directory blank (repository root).

- Build Command: `npm install --omit=dev`
- Start Command: `npm run start:api`
- Health Check Path: `/health`
- Region: Singapore
- Plan: Free (single instance; capacity is limited and should be load-tested before a large launch)

### Required backend variables

- `TURSO_DATABASE_URL`: Turso database URL.
- `TURSO_AUTH_TOKEN`: database token; backend-only.
- `TELEGRAM_BOT_TOKEN`: bot token from @BotFather; backend-only.
- `ADSGRAM_REWARD_SECRET`: private AdsGram callback secret.
- `PAYOUT_CRON_SECRET`: separate private payout callback secret.
- `TON_WALLET_MNEMONIC`: dedicated payout wallet recovery phrase; highly sensitive.
- `FRONTEND_URL`: `https://play-for-win-bice.vercel.app`.
- `FRONTEND_URLS`: optional comma-separated allow-list of exact additional frontend origins.

### Optional backend variables

- `TONCENTER_API_KEY`: optional Toncenter API key.
- `TON_WALLET_VERSION`: `v5r1` (default) or `v4`, matching the payout wallet contract.
- `PAYMENT_PROOF_CHAT_ID`: Telegram channel username or numeric chat ID.
- `PAYMENTS_PROOF_URL`: public payment-proof link.
- `BOT_APP_URL`: `https://play-for-win-bice.vercel.app`.
- `BOT_OFFICIAL_CHANNEL_URL` and `BOT_SUPPORT_GROUP_URL`: your Telegram links.

Only add exact, approved Vercel preview hostnames to `FRONTEND_URLS` when you need direct browser API calls from a preview deployment.

## Vercel static frontend

The frontend is a Vite + TanStack Router SPA.

- Root Directory: `frontend`
- Framework Preset: Vite
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment variable: `VITE_BACKEND_URL=https://gramminer-backend.onrender.com`

`VITE_BACKEND_URL` is public configuration, not a secret. Never put backend credentials in a `VITE_*` variable. Vercel serves the frontend shell, route chunks, CSS and static assets from its CDN. Gameplay API calls go directly to Render, so those calls do not create Vercel Function invocations.

Routes `/`, `/refer`, `/donate` and `/withdraw` use client-side navigation. `frontend/vercel.json` rewrites route visits to `index.html`. Route code is split so a user downloads the page code when it is needed.

## Telegram Mini App

Configure the bot's Main Mini App or Menu Button URL in @BotFather to:

`https://play-for-win-bice.vercel.app`

TON Connect manifest:

`https://play-for-win-bice.vercel.app/tonconnect-manifest.json`

The manifest and icon should use the canonical production domain.

## AdsGram rewarded callback

The browser loads the AdsGram SDK only after a user taps Watch Ad. Reward credit is never granted merely because the browser SDK reports completion. The backend checks the callback secret, active ad session, phase, expiry, cooldown and duplicate status before crediting Turso.

Set AdsGram's Reward URL to call Render directly (not through Vercel):

```text
https://gramminer-backend.onrender.com/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]
```

Replace the secret placeholder with the exact value stored in Render. Keep the literal `[userId]` placeholder unchanged. Never place the secret in frontend code or a `VITE_*` variable.

AdsGram's documented Reward URL carries a user ID, not a signed per-view event ID. The callback uses the private URL secret and the backend's single-active-session/idempotency checks; it is not an independently signed proof payload.

## Payout schedule

Configure an external scheduler to call Render directly every minute:

```text
https://gramminer-backend.onrender.com/api/public/payout?key=YOUR_PAYOUT_CRON_SECRET
```

Keep the secret private. The backend locks payout batches, confirms in-flight transfers and posts per-withdrawal proof messages after confirmation. Add the bot as an administrator in the payment-proof channel when using `PAYMENT_PROOF_CHAT_ID`.

## Capacity and scale

A static Vercel frontend removes per-page server rendering and frontend API proxy Functions from the normal gameplay path. It does not make the complete game automatically ready for 100,000 users: Render API capacity, Turso read/write limits, rewarded-ad verification and TON payout processing are separate bottlenecks. Load-test the backend and database before promoting a large campaign. Scale backend resources separately from the frontend hosting tier.

Never commit `.env` files, Turso tokens, Telegram bot tokens, callback secrets, or wallet recovery phrases.
