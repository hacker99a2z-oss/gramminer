# Gram Miner — Cloudflare Pages + Workers

## Architecture

- **Frontend:** Cloudflare Pages serves the static Telegram Mini App.
- **Game API:** Cloudflare Workers runs `backend/worker.ts`.
- **Database:** Keep the existing Turso/libSQL database and all player balances. The Worker uses `@libsql/client/web`, the Workers-compatible HTTP client.
- **TON payouts:** Keep the existing Node payout service on Render during this first-stage migration. The existing GitHub Actions payout schedule continues to call Render every 15 minutes. Do not set `PAYOUT_BACKEND_URL` to the Worker.
- **Rollback:** Keep Render and the previous Vercel deployment available until all Worker and Telegram flows pass.

Normal game API calls go directly from the browser to the Worker by way of `VITE_BACKEND_URL`. The Pages Functions only proxy the AdsGram callback and expose the TonConnect manifest; they do not proxy ordinary game API requests.

## Important limits and cost

Cloudflare Workers Free currently allows **100,000 requests per day** and **10 ms CPU time per HTTP invocation**. This is not enough for 200,000–300,000 daily active users if each user makes one or more API requests per day. The Workers Paid Standard plan starts at **$5/month**, includes 10 million requests/month and 30 million CPU milliseconds/month, and bills separately for usage above those allowances. Paid permits up to 5 minutes CPU per invocation (30 seconds by default). These are billing and runtime allowances, not a guarantee of a particular DAU or peak concurrency.

Estimate real costs from measured API requests per active user, CPU time, Turso reads/writes and peak traffic. Review current official limits before launch:
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/

There is no free tier that guarantees 200,000–300,000 DAU without errors. Set billing alerts and rate controls before public launch.

## 1. Create Worker from GitHub

1. Cloudflare Dashboard → **Workers & Pages** → **Create application**.
2. Choose **Connect to Git** and connect `hacker99a2z-oss/gramminer`.
3. Select branch `main`.
4. Set the root directory to the repository root (`/`).
5. Use repository `wrangler.jsonc`; entry point is `backend/worker.ts`.
6. Set build command: `npm install --no-audit --no-fund && npm run build:worker`.
7. If the dashboard asks for a deploy command, set `npx wrangler deploy`.
8. Cloudflare will give a URL similar to `https://gramminer-backend.<account-subdomain>.workers.dev`.

To deploy locally from the repository root:
```sh
npm install
npm run deploy:worker
```
Do not deploy until Worker variables and secrets are configured.

## 2. Worker variables and secrets

Cloudflare Dashboard → Workers & Pages → `gramminer-backend` → **Settings → Variables and Secrets**.

Add these plain-text variables:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | Exact existing Turso URL from the current Render backend |
| `FRONTEND_URL` | `https://gramminer-c68.pages.dev` |
| `FRONTEND_URLS` | Pages Production URL, Pages Preview URL and old Vercel origin, comma-separated |
| `BOT_APP_URL` | `https://gramminer-c68.pages.dev` |
| `PAYMENT_PROOF_CHAT_ID` | Existing value, if used |
| `PAYMENTS_PROOF_URL` | Existing value, if used |

Add these as **Secret** values (not plain text):

- `TURSO_AUTH_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `ADSGRAM_REWARD_SECRET`

Never put real secrets in source files, `wrangler.jsonc`, `VITE_*` variables, screenshots or chat. Do not add `TON_WALLET_MNEMONIC`, `TONCENTER_API_KEY`, or `PAYOUT_CRON_SECRET` to the Worker; keep them on the existing payout service.

The Wrangler config enables Node.js compatibility and `process.env` population so existing service modules can read Cloudflare-bound variables/secrets. The Worker database module imports `@libsql/client/web`, as required by Cloudflare's official Turso Workers guide.

## 3. Connect Cloudflare Pages to the Worker

After the Worker deploys successfully, copy its exact `workers.dev` URL.

Cloudflare Pages → `gramminer-c68` → **Settings → Variables and Secrets**. Add in both Production and Preview:

- `VITE_BACKEND_URL` = exact Worker URL.
- `BACKEND_URL` = exact Worker URL.

Redeploy Pages so `VITE_BACKEND_URL` is compiled into the browser bundle. Set the Worker `FRONTEND_URLS` variable to include:
- `https://gramminer-c68.pages.dev`
- `https://3f5ed6da.gramminer-c68.pages.dev`
- The existing Vercel origin while rollback is required.

## 4. Health checks and smoke tests

- `GET /health`: Worker liveness check.
- `GET /ready`: runs `SELECT 1` against Turso to verify connectivity.

Test the Preview Pages app before changing production:
- Telegram initData validation and game load.
- Miner purchase and claim with a test account.
- Daily bonus with a test account.
- Referral list and claim with test accounts.
- AdsGram session start, provider callback and one-time reward credit.
- Withdrawal request/status with a test account. Do not send a real TON payment during smoke tests.
- Leaderboard and direct Pages routes (`/refer`, `/donate`, `/withdraw`).
- Worker logs, browser console and Turso read/write usage.

Never run write-path load tests against real users or the production database. A read-only k6 script exists in `loadtest/leaderboard.js`; use it only against a staging Worker connected to a staging/test database:
```sh
k6 run -e BASE_URL=https://YOUR_STAGING_WORKER_URL -e CONFIRM_STAGING=yes loadtest/leaderboard.js
```
It ramps to 50 virtual users and tests only the read-only leaderboard. It does not prove write-path, reward, withdrawal or 200,000–300,000 DAU capacity.

## 5. Telegram, AdsGram and payout boundaries

- Telegram `/start` webhook remains on Render for this first stage. Do not change the Telegram webhook until Worker API, webhook signature and welcome behaviour are separately verified.
- AdsGram reward URL should use the Pages proxy:
  `https://gramminer-c68.pages.dev/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]`
  Keep the literal `[userId]` placeholder and add the matching secret to the Worker.
- GitHub Actions payout schedule continues calling the existing Render endpoint every 15 minutes. Keep `PAYOUT_BACKEND_URL` unset (so its Render default applies) or explicitly set it to the current Render service URL. Keep the existing `PAYOUT_CRON_SECRET` GitHub secret.
- The Worker intentionally returns HTTP 503 from `/api/public/payout`. The Worker is not the payout executor. TON wallet signing, transfer construction and proof posting remain on the Node service. Do not send the wallet mnemonic to Cloudflare.

## 6. Rate controls, logs and production safety

- Configure Cloudflare WAF/Rate Limiting for abusive traffic to `/api/game/*` and callback routes. Avoid blanket low thresholds that block normal gameplay.
- Monitor Worker request count, CPU time, exceptions and subrequests.
- Monitor Turso rows read/written, storage and query latency.
- Monitor AdsGram callback failures and the Pending withdrawal backlog.
- Configure billing alerts before moving to Paid.
- All balance-changing actions continue to be validated and committed by the server; the browser is never the source of truth for coins or withdrawable balances.

## 7. Rollback

If Worker API tests fail, change both Pages values back to:
- `VITE_BACKEND_URL=https://gramminer-backend.onrender.com`
- `BACKEND_URL=https://gramminer-backend.onrender.com`

Redeploy Pages. Keep Render online and the previous Vercel deployment available until the Worker path is stable. Do not change or migrate the existing Turso production database.
