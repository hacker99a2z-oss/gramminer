# Gram Miner — Render setup (Cloudflare Pages + Workers frontend/API)

This guide is only for the existing Render service. The Cloudflare Pages frontend and Cloudflare Worker game API are separate and remain the public app/API entrypoints.

## Existing Render service (already found)

- Service: `gramminer-backend`
- URL: `https://gramminer-backend.onrender.com`
- GitHub repo: `hacker99a2z-oss/gramminer`
- Branch: `main`
- Root directory: blank (repository root)
- Runtime: Node
- Current plan: Free
- Current build command: `npm install`
- Current start command: `npm run start:api`
- Region: Singapore
- Auto deploy: enabled on commits to `main`

Open it here: https://dashboard.render.com/web/srv-dbi09tlg1s2s73djc4dg

Do not create a second Render web service, Render Postgres database, Redis/Key Value instance or separate worker for this setup. Keep the current service.

## What belongs on Render

Render is the private-in-purpose Node backend for:
- TON payout batch processing and wallet signing.
- Payout transaction confirmation and payment-proof messages.
- Telegram Bot API webhook handling (`/api/telegram/webhook`), including `/start`.
- Existing shared Turso access for reading pending withdrawals and storing payout status / Telegram file cache.

The following stay on Cloudflare:
- Static frontend delivery and CDN caching (Pages).
- Public game API and all user-facing gameplay requests (Workers).
- Telegram initData validation and game rules for the public app (Workers).
- Public leaderboard edge caching (Workers).
- Public entry path for AdsGram callback after it is switched to Pages → Worker.

Turso remains the single source of truth for player coins, withdrawable balance, miners, referrals and withdrawals. It is a database, not another API server. Do not create a new database and do not copy/reset production player rows as part of this Render setup.

## Render dashboard — step by step

### 1. Open the existing service

1. Open https://dashboard.render.com/web/srv-dbi09tlg1s2s73djc4dg.
2. Go to **Settings**.
3. Confirm the connected repository is `hacker99a2z-oss/gramminer`.
4. Confirm branch is `main`.
5. Leave Root Directory blank.
6. Keep Node runtime, build command `npm install`, and start command `npm run start:api` (these are the currently detected live values).
7. Set Health Check Path to `/health`.
8. Keep the existing Singapore region and the current instance while staging is being tested.

Render currently reports this service as Free. Free services sleep after 15 minutes without inbound traffic and may need about one minute to wake. Keep this in mind for Telegram `/start` response time and scheduled payouts. Render says Free instances are for testing/hobby use rather than production. See https://render.com/docs/free.

### 2. Environment variables to keep on Render

Open **Environment**. Keep existing secrets and values; do not click Replace All and do not delete values you already use.

| Variable | What to put on Render | Notes |
|---|---|---|
| `NODE_VERSION` | `22.18.0` | Keep Node 22. |
| `TURSO_DATABASE_URL` | Existing production `libsql://...` URL | Keep the existing database. |
| `TURSO_AUTH_TOKEN` | Existing Turso auth token | Secret; backend only. |
| `TELEGRAM_BOT_TOKEN` | Existing token from @BotFather | Secret. |
| `TON_WALLET_MNEMONIC` | Existing dedicated payout wallet mnemonic | Secret; Render only, never Cloudflare/browser. |
| `TONCENTER_API_KEY` | Existing key, if used | Secret; Render only. |
| `TON_WALLET_VERSION` | `v5r1` | Must match the wallet contract already funded for payouts. Do not change casually. |
| `PAYOUT_CRON_SECRET` | Strong random value | Keep the existing value if the GitHub Actions secret already matches. Later share the same value with the Worker. |
| `PAYMENT_PROOF_CHAT_ID` | Existing channel username or numeric chat ID | Bot must be channel admin and able to post. |
| `PAYMENTS_PROOF_URL` | Existing public proof-channel URL | Example: `https://t.me/your_channel`. |
| `BOT_OFFICIAL_CHANNEL_URL` | Existing official Telegram channel URL | Optional welcome-button link. |
| `BOT_SUPPORT_GROUP_URL` | Existing support-group URL | Optional welcome-button link. |
| `FRONTEND_URL` | Exact production Cloudflare Pages origin | Origin only; no path or trailing slash. |
| `FRONTEND_URLS` | Comma-separated exact Pages production and custom-domain origins | Add preview origins only when needed. |
| `BOT_APP_URL` | Exact production Cloudflare Pages URL | This is the URL the Telegram welcome button opens. |

For `FRONTEND_URL`, `FRONTEND_URLS` and `BOT_APP_URL`, copy the real hostname shown in **Cloudflare → Workers & Pages → Pages project → Custom domains / Deployments**. Do not guess the Pages URL. If the Pages project is currently called `gramminer-c68`, its default hostname may be `https://gramminer-c68.pages.dev`; use the dashboard value as the source of truth.

### 3. Webhook routing — two phases

**Phase A: before the Worker proxy has been deployed to production**

- Keep `PUBLIC_BACKEND_URL=https://gramminer-backend.onrender.com`.
- Keep the existing Telegram webhook unchanged.
- Keep `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=false` (or leave it unset, which also skips auto-registration).
- Do not point Telegram to the Worker yet: the Worker must first have the fixed `POST /api/telegram/webhook` Render proxy route deployed.

**Phase B: only after the Worker webhook proxy is live and tested**

1. Change `PUBLIC_BACKEND_URL` to the exact production Worker base URL (for example, the dashboard's `https://gramminer-backend.<account>.workers.dev` or your configured API hostname).
2. Set `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=true`.
3. Restart/redeploy the Render service once.
4. Confirm Render logs say `Telegram /start webhook configured`.
5. Immediately set `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=false` and save/redeploy.
6. Test Telegram `/start`; it should reach Cloudflare Worker, then Render, and return the welcome message.

The Telegram bot token remains on Render. The Worker forwards Telegram's webhook secret header unchanged; Render continues to verify it.

### 4. Payout routing — two phases

**Phase A: before the Worker payout proxy is live**

- Keep the existing GitHub Actions variable `PAYOUT_BACKEND_URL` pointing to `https://gramminer-backend.onrender.com`.
- Keep the existing GitHub Actions secret `PAYOUT_CRON_SECRET` exactly equal to Render's value.
- Do not change the payout scheduler yet.

**Phase B: after the Worker and Pages payout proxy are live**

1. Set GitHub repository **Settings → Secrets and variables → Actions → Variables**:
   - `PAYOUT_BACKEND_URL=https://YOUR-PRODUCTION-PAGES-HOST`
2. Keep GitHub Actions repository secret `PAYOUT_CRON_SECRET` equal to Render and Worker.
3. Pages Function receives the cron request and forwards the Authorization bearer header to the Worker.
4. Worker validates the secret and calls the fixed Render `GET /api/public/payout` path.
5. Render runs the existing payout lock, TON signing, confirmation and proof posting.

Do not put the payout secret in the URL, frontend code, Pages build variables or Telegram bot messages.

### 5. AdsGram callback routing

After the Pages Function and Worker reward endpoint are deployed, change AdsGram's Reward URL to:

```text
https://YOUR-PRODUCTION-PAGES-HOST/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]
```

Keep the literal `[userId]` placeholder. The callback secret belongs in Worker Secrets and AdsGram's provider settings, never in frontend JavaScript or a `VITE_*` variable.

For rollback during the migration, keep the existing `ADSGRAM_REWARD_SECRET` on Render as well until you have verified that AdsGram callbacks are reaching the Worker successfully. The final edge-only lock is a later step.

### 6. Do not enable edge-only mode yet

The Render Node service currently still has the legacy game API routes. The edge-only guard is part of the not-yet-promoted Cloudflare migration code.

- For now: `EDGE_ONLY_API=false` or unset.
- Only after the Worker/Pages code containing the edge-only guard is on `main`, deployed, and all production smoke tests pass: set `EDGE_ONLY_API=true`.
- Then test that direct Render `/api/game/*` and direct AdsGram reward routes are rejected, while Worker game API, Telegram webhook proxy and payout proxy still work.

Never turn edge-only mode on before the Worker proxy and Pages client are ready. It would block the current direct routes and can interrupt the app.

## What must NOT go on Render

Do not add these:
- `VITE_BACKEND_URL` (Cloudflare Pages build variable).
- `BACKEND_URL` (Cloudflare Pages Functions variable).
- `RENDER_BACKEND_URL` (Cloudflare Worker variable, used to reach Render).
- Any `VITE_*` variables.
- A second game database or a separate balance database.
- Cloudflare API tokens.
- Browser/session data, client balances or client-generated reward amounts.

Never send bot tokens, Turso tokens, payout secrets, mnemonic words or wallet recovery phrases in ChatGPT. Add them directly to Render's Environment Secret fields and your password manager.

## Deployment and rollback

Render is connected to `main` with Auto Deploy enabled. A push to `main` can automatically restart this service. Therefore, do not merge untested Worker/client code until staging verification is complete.

If Telegram webhook or payout proxy fails after cutover:
1. Set `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=false`.
2. Restore `PUBLIC_BACKEND_URL=https://gramminer-backend.onrender.com` and register the webhook once if the Worker proxy is unavailable.
3. Restore GitHub Actions `PAYOUT_BACKEND_URL=https://gramminer-backend.onrender.com`.
4. Set `EDGE_ONLY_API=false`.
5. Keep the same Turso database and TON wallet; do not reset balances or payout rows.

## Related documentation

- [Production cutover checklist](./PRODUCTION_CUTOVER_CHECKLIST.md)
- [Cloudflare Worker and Pages deployment](./CLOUDFLARE_WORKERS.md)
- [Render Free limitations](https://render.com/docs/free)
