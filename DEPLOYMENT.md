# Gram Miner deployment and credentials

## Architecture

- frontend: static React + TanStack Router SPA served by the Vercel CDN.
- backend: Node.js JSON API, game logic, Turso access, Telegram Bot API, AdsGram callback verification and cron-triggered TON payout worker on Render.
- backend/turso/schema.sql: fresh-install Turso/libSQL schema.
- Existing Turso databases receive additive migrations on backend startup; player balances and existing payout rows are preserved.

Gameplay requests go directly from the browser to Render. Telegram Mini App initData remains validated server-side. Backend credentials and payout wallet mnemonics are never exposed to the browser.

## Turso database

1. Create a Turso database in a region close to Render's Singapore region when practical.
2. Copy the database URL and create an auth token.
3. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to Render > gramminer-backend > Environment.
4. The backend applies additive migrations at startup. Back up the database before deploying schema changes.

## Render backend

Keep Root Directory blank (repository root).

- Build Command: npm install --omit=dev
- Start Command: npm run start:api
- Health Check Path: /health
- Region: Singapore
- Plan: Free (single instance; load-test capacity before a large launch)

Required variables:
- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN
- TELEGRAM_BOT_TOKEN
- ADSGRAM_REWARD_SECRET
- PAYOUT_CRON_SECRET (separate from the AdsGram secret)
- TON_WALLET_MNEMONIC (dedicated payout wallet recovery phrase; highly sensitive)
- FRONTEND_URL=https://play-for-win-bice.vercel.app
- FRONTEND_URLS (optional comma-separated exact frontend origin allow-list)

Optional variables:
- TONCENTER_API_KEY
- TON_WALLET_VERSION=v5r1 (default) or v4, matching the actual payout wallet contract
- PAYMENT_PROOF_CHAT_ID
- PAYMENTS_PROOF_URL
- BOT_APP_URL=https://play-for-win-bice.vercel.app
- BOT_OFFICIAL_CHANNEL_URL and BOT_SUPPORT_GROUP_URL

## Vercel static frontend

- Root Directory: frontend
- Framework Preset: Vite
- Install Command: npm install --legacy-peer-deps
- Build Command: npm run build
- Output Directory: dist
- Public environment variable: VITE_BACKEND_URL=https://gramminer-backend.onrender.com

Only add exact approved preview hostnames to FRONTEND_URLS. Never add secrets to VITE_* variables.

## Telegram Mini App

Set the bot's Main Mini App or Menu Button URL in @BotFather to:

https://play-for-win-bice.vercel.app

TON Connect manifest:

https://play-for-win-bice.vercel.app/tonconnect-manifest.json

Telegram initData is accepted for one hour after auth_date. Users with an older open session must reopen the Mini App inside Telegram.

## AdsGram rewarded callback

Set AdsGram's Reward URL to call Render directly:

https://gramminer-backend.onrender.com/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]

Replace only the secret placeholder; keep [userId] unchanged. The backend checks the private URL secret, current session, phase, expiry, cooldown and duplicate status.

Provider limitation: AdsGram's documented Reward URL sends the Telegram user ID, not a unique ad-view/session event ID. The backend cannot cryptographically correlate a delayed callback to one exact view. A 10-minute safety window is applied when a started ad is abandoned or expires before another session can begin. This reduces cross-session reward attribution but cannot eliminate callbacks delayed longer than the window. This callback format is not a signed per-view proof.

## Payout cron

The player-facing withdrawal, game-load and status APIs only enqueue/read withdrawals. They do not call TON Center or broadcast transactions. Configure an external scheduler to send an HTTP POST every minute directly to:

https://gramminer-backend.onrender.com/api/public/payout
Authorization: Bearer YOUR_PAYOUT_CRON_SECRET
Content-Type: application/json

No request body is required. Keep the secret out of URLs and logs. The old GET ?key=... method is temporarily retained for existing schedulers and logs a deprecation warning; migrate it to POST + Bearer authentication because URL query strings can appear in access logs.

The worker uses an owner-token database lease, lease renewal, request timeouts and idempotent rebroadcast of the exact persisted signed BOC. It marks a withdrawal sent only when the wallet transaction's inbound external-message hash and its outgoing destination, exact nanotons and unique body hash match the withdrawal. Seqno movement alone is not a success signal.

Legacy in-flight payout batches created before this change do not have the signed BOC/message identity needed for safe reconciliation. They are moved to manual_review and are not automatically re-sent. Reconcile those rows against TON wallet history before changing their status. New payouts can also enter manual_review if an on-chain transaction is detected but expected outgoing messages cannot all be matched.

When PAYMENT_PROOF_CHAT_ID is set, the cron worker publishes transaction-linked proof messages and retries failed Telegram posts with exponential backoff. Public proof messages omit Telegram IDs and wallet addresses. Proof posting is at-least-once: a Telegram response lost after successful delivery can still cause a duplicate proof post on retry.

Before enabling the new payout cron: back up Turso and reconcile any old sending batch manually. The previous GET/query-secret scheduler keeps working during migration, but should be updated to POST + Bearer header.

## CI and tests

GitHub Actions runs backend TypeScript checks and tests, then frontend Vite build (which regenerates the TanStack route tree), typecheck, tests and lint. Dependency lockfiles are not yet committed; generate and commit them before treating installs as fully reproducible.

## Capacity

A static Vercel frontend removes per-page server rendering and frontend API proxy Functions from normal gameplay. It does not make the game automatically ready for 100,000 users: Render API capacity, Turso limits, rewarded-ad verification and TON payout processing remain separate bottlenecks. Load-test before a large launch.

Never commit .env files, Turso tokens, Telegram bot tokens, callback secrets or wallet recovery phrases.
