# Gram Miner — Cloudflare cutover checklist

This is the operator checklist for moving the current app to the Cloudflare-first architecture. Keep the PR unmerged and Render's `EDGE_ONLY_API` disabled until the preview checks are complete.

## Current resources

- GitHub repository: `hacker99a2z-oss/gramminer`
- Preview code branch: `architecture/service-api-routing`
- Existing Cloudflare Pages app URL used by this repository: `https://gramminer-c68.pages.dev`
- Existing Render service: `https://gramminer-backend.onrender.com`
- Worker name in `wrangler.jsonc`: `gramminer-backend`
- Existing authoritative database: the current production Turso database; do not use it for test writes.

## 1. Create a separate staging Turso database

Install/authenticate the Turso CLI, then create a blank database (do not clone real users or production balances into it):

```sh
turso auth login
turso db create gramminer-staging
turso db show gramminer-staging --url
turso db tokens create gramminer-staging --expiration never
turso db shell gramminer-staging
```

Copy/paste the SQL statements from `backend/turso/schema.sql` into the SQL shell and run them. Copy the staging database URL and its token into a password manager temporarily; do not commit either to GitHub.

The staging schema has empty player/withdrawal data. Use only a Telegram test account.

## 2. Deploy a Cloudflare Worker preview

1. Cloudflare Dashboard → **Workers & Pages** → create/connect a Worker using the GitHub repository `hacker99a2z-oss/gramminer`.
2. Worker name: `gramminer-backend`.
3. Production branch: `main`; enable Preview Builds for non-production branches.
4. Build command: `npm install --no-audit --no-fund && npm run build:worker`.
5. Production deploy command: `npx wrangler deploy`.
6. Enable Preview Builds under **Settings → Build → Branch control**. Set the Preview command to `npx wrangler preview`; Preview builds must use their own staging variables/secrets rather than production values.
7. Ensure the Worker uses `wrangler.jsonc` and `backend/worker.ts` as its entrypoint.
8. Configure preview-specific variables/secrets (do not copy production Turso credentials into Preview):

Plain-text preview variables:
- `TURSO_DATABASE_URL` = staging database URL from step 1.
- `FRONTEND_URLS` = exact Cloudflare Pages PR preview origin once it is available.
- `FRONTEND_URL` = the same preview origin.
- `BOT_APP_URL` = the Pages PR preview origin.
- `RENDER_BACKEND_URL` = omit during game-only preview tests; set to the Render service only when intentionally testing webhook/payout proxy paths.

Preview secrets:
- `TURSO_AUTH_TOKEN` = staging database token.
- `TELEGRAM_BOT_TOKEN` = a dedicated test bot token is preferred. If you use the production bot token for validation, never expose it and test only with a dedicated test account.
- `ADSGRAM_REWARD_SECRET` = a test callback secret (only if testing AdsGram callbacks).
- `PAYOUT_CRON_SECRET` = a staging-only random secret (only if testing the payout proxy; do not invoke real production payouts).

After deployment, copy the exact Worker Preview URL. Check:
- `GET https://YOUR-WORKER-PREVIEW/health` returns 200.
- `GET https://YOUR-WORKER-PREVIEW/ready` returns 200 with the staging database connected.

Do not test the payout proxy against the production Render payout service or use real TON transfers during preview.

## 3. Configure the Cloudflare Pages PR preview

The existing Pages project should be Git-connected to `hacker99a2z-oss/gramminer`. Set:

- Root directory: `frontend`
- Build command: `npm install --no-audit --no-fund && npm run build:pages`
- Build output: `frontend/dist`
- Production branch: `main`
- Preview branch control: include `architecture/service-api-routing` (or enable PR previews).

Pages Git integration creates a branch/PR preview URL without changing the production branch. In **Settings → Builds → Branch control**, keep `main` as the Production branch and enable Preview builds for `architecture/service-api-routing`. After the preview exists, set these **Preview-only** variables:

- `VITE_BACKEND_URL` = exact Worker Preview URL from step 2.
- `BACKEND_URL` = exact Worker Preview URL from step 2.

Redeploy/rebuild the PR preview after changing variables. Copy its exact origin (scheme + hostname only) into the Worker Preview's `FRONTEND_URL` and `FRONTEND_URLS`.

Keep all Production Pages variables unchanged until the preview has passed.

## 4. Preview tests

Open the Pages PR preview inside Telegram using a dedicated test account, then check:

1. Telegram initData validation and profile/game load.
2. Buy a miner with sufficient staging coins.
3. Try to buy without enough coins; server must reject it.
4. Claim a miner only after its server-calculated timer has expired.
5. Claim daily bonus once; a second claim must fail.
6. Replay the same `/api/game/sync` batch with identical action IDs; it must not double-debit or double-credit.
7. Tamper with localStorage queue values (for example, change miner ID or add a fake amount field); schema/server must reject invalid fields and never accept a client-supplied balance.
8. Close/reopen the Mini App with pending test actions; queued commands should be replayed with the same IDs.
9. Test donation and referral eligibility with test accounts.
10. Confirm leaderboard can be served from the Worker edge cache; player balance/profile responses must have `Cache-Control: no-store`.

Withdrawals, AdsGram callback, Telegram webhook and payout should be tested as separate controlled flows. Do not submit a real withdrawal or invoke the real payout service during Preview.

## 5. Production Worker variables/secrets

After Preview passes, configure the production Worker environment:

Plain-text variables:
- `TURSO_DATABASE_URL` = existing production Turso URL.
- `FRONTEND_URL` = `https://gramminer-c68.pages.dev`.
- `FRONTEND_URLS` = exact production Pages origin and any exact custom-domain origins.
- `BOT_APP_URL` = `https://gramminer-c68.pages.dev`.
- `RENDER_BACKEND_URL` = `https://gramminer-backend.onrender.com`.
- `PAYMENT_PROOF_CHAT_ID` and `PAYMENTS_PROOF_URL` = existing values if configured.

Worker secrets:
- `TURSO_AUTH_TOKEN` = existing production Turso token.
- `TELEGRAM_BOT_TOKEN` = existing bot token.
- `ADSGRAM_REWARD_SECRET` = same callback secret currently used by AdsGram/Render.
- `PAYOUT_CRON_SECRET` = strong random value shared with Render and the GitHub Actions repository secret.

Never put TON wallet mnemonic or TONCenter signing key in the Worker.

## 6. Production Pages variables

After the production Worker is deployed and `/health` and `/ready` both pass:

- `VITE_BACKEND_URL` = exact production Worker URL.
- `BACKEND_URL` = exact production Worker URL.

Redeploy Pages. Verify that the Mini App uses Worker requests, not direct requests to Render.

AdsGram callback URL should use the Pages Function:

```text
https://gramminer-c68.pages.dev/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]
```

Keep the literal `[userId]` placeholder. Configure the URL with the existing AdsGram provider settings; never place the secret in frontend JS or a `VITE_*` variable.

## 7. Render production service

Keep the existing service `gramminer-backend`; do not create a new payout service or change its production Turso database.

Set/verify:
- `PUBLIC_BACKEND_URL` = exact production Worker URL (Telegram registers its webhook at the Worker).
- `BOT_APP_URL` = `https://gramminer-c68.pages.dev`.
- `PAYOUT_CRON_SECRET` = same value as Worker and GitHub Actions.
- Keep `TON_WALLET_MNEMONIC`, TON signing keys and `TONCENTER_API_KEY` on Render only.
- `TELEGRAM_AUTO_CONFIGURE_WEBHOOK` should be `true` only for one intentional restart that re-registers the webhook, then set it back to `false`.
- Keep `EDGE_ONLY_API=false` until the production Pages/Worker flow and webhook/payout proxy have been verified.

## 8. Route scheduled payout through Cloudflare

In GitHub repository **Settings → Secrets and variables → Actions**:

- Repository variable `PAYOUT_BACKEND_URL` = `https://gramminer-c68.pages.dev`.
- Repository secret `PAYOUT_CRON_SECRET` = same strong secret used on Worker and Render.

The scheduled GitHub Action calls Pages `/api/public/payout`; Pages proxies to Worker; Worker checks the bearer secret and proxies to Render; Render runs the locked TON payout process. Use `workflow_dispatch` only after verifying the staging flow or when intentionally processing production withdrawals.

## 9. Lock direct game API access on Render

Only after all production checks pass:

1. Set Render `EDGE_ONLY_API=true`.
2. Redeploy/restart the Render service.
3. Confirm direct `https://gramminer-backend.onrender.com/api/game/load` and direct AdsGram reward calls are rejected.
4. Confirm the same game API calls still work through the Cloudflare Worker.
5. Confirm `POST /api/telegram/webhook` and authenticated `GET /api/public/payout` still work through the Worker proxy.

If any check fails, set `EDGE_ONLY_API=false` and restore Pages `VITE_BACKEND_URL`/ `BACKEND_URL` to the last working endpoint. Do not delete the Turso database or Render service.

## What must be done by the account owner

- Connect/authorize the GitHub repository in Cloudflare if it is not already connected.
- Create the blank staging Turso database and keep its credentials private.
- Add the Worker Preview and Production variables/secrets in Cloudflare.
- Add Preview and Production variables to Pages.
- Configure the Render environment values and webhook timing.
- Add `PAYOUT_BACKEND_URL` and `PAYOUT_CRON_SECRET` in GitHub Actions settings.
- Update the AdsGram callback URL in the AdsGram provider dashboard.
- Open the preview inside Telegram and run the listed test account flows.

Do not send any secrets, mnemonic words, API tokens, or database tokens into chat. Use dashboard Secret fields/password manager.


## Official setup references

- [Cloudflare Workers Git integration and Preview Builds](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
- [Cloudflare Workers Preview build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Cloudflare Pages Git integration and pull-request previews](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [Turso CLI: create database](https://docs.turso.tech/cli/db/create)
- [Turso CLI: show database URL](https://docs.turso.tech/cli/db/show)
- [Turso CLI: create database token](https://docs.turso.tech/cli/db/tokens/create)
- [Render Free service limitations](https://render.com/docs/free)
