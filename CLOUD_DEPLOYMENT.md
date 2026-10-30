# Gram Miner Cloudflare Pages + Cloud Run deployment guide

## Target architecture

- **Frontend:** Cloudflare Pages, built as a TanStack Start SPA. Static HTML, JavaScript, CSS, images and other assets are served from Pages' CDN.
- **Backend:** Google Cloud Run, running the existing Node.js 22 API.
- **Database:** Keep the existing Turso/libSQL database. Do not create a new database or migrate balances.
- **Payout schedule:** GitHub Actions calls the Cloud Run payout endpoint every 15 minutes. The existing Render service remains available for rollback until all checks pass.

Game actions call Cloud Run directly from the Mini App browser. The browser never owns the source of truth for coins or withdrawable balance. The few Pages server routes retained for AdsGram reward callback, payout proxy compatibility and TonConnect manifest are low-volume routes; those requests count as Pages Function invocations. Do not put game API calls through Pages Functions.

Production traffic must only be switched after the Cloud Run and Pages deployments have been smoke-tested. Keep the Render service and current Vercel deployment available for rollback.

## 1. Prepare Google Cloud Run

Use Google Cloud project region **asia-southeast1 (Singapore)** for the API.

1. Create/select a Google Cloud project and enable billing. Free usage still requires a billing-enabled project; usage beyond the free allowance is billable.
2. Install Google Cloud CLI, sign in, and set the project:

   ```sh
   gcloud auth login
   gcloud config set project YOUR_GOOGLE_CLOUD_PROJECT_ID
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
   ```

3. From the repository root, deploy the included `Dockerfile`:

   ```sh
   gcloud run deploy gramminer-backend \
     --source . \
     --region asia-southeast1 \
     --port 8080 \
     --cpu 1 \
     --memory 1Gi \
     --concurrency 20 \
     --max 5 \
     --timeout 300 \
     --allow-unauthenticated
   ```

   The initial `--max 5` is a conservative cost-control cap for testing, not a capacity guarantee. Increase it only after load tests and budget alerts are in place. With minimum instances left at zero, the service can scale to zero when idle and may have a cold start.

4. In Cloud Run > `gramminer-backend` > Edit and deploy new revision, configure the following non-secret environment variables:
   - `TURSO_DATABASE_URL`: the existing Turso database URL.
   - `TON_WALLET_VERSION=v5r1` (or `v4` only if that matches the payout wallet).
   - `FRONTEND_URL`: the Pages production URL, once created.
   - `FRONTEND_URLS`: comma-separated allowed frontend origins. During migration include the new Pages URL and the old production Vercel URL.
   - `PUBLIC_BACKEND_URL`: the Cloud Run HTTPS service URL shown in the Cloud Run service page.
   - `BOT_APP_URL`: the new Pages Mini App URL.
   - `PAYMENT_PROOF_CHAT_ID`, `PAYMENTS_PROOF_URL`, `BOT_OFFICIAL_CHANNEL_URL`, `BOT_SUPPORT_GROUP_URL`: use your existing values.
   - `TELEGRAM_AUTO_CONFIGURE_WEBHOOK`: initially set to `false`. Change to `true` only for the one-time webhook cutover described below, then return it to `false`.

5. Store secrets in Google Secret Manager and expose them to the Cloud Run service as environment-variable secrets. Required:
   - `TURSO_AUTH_TOKEN`
   - `TELEGRAM_BOT_TOKEN`
   - `ADSGRAM_REWARD_SECRET`
   - `PAYOUT_CRON_SECRET`
   - `TON_WALLET_MNEMONIC`
   - `TONCENTER_API_KEY` (optional, but recommended for predictable Toncenter API quotas)

   Grant the Cloud Run service identity permission to access those secrets. Do not put real secret values in GitHub, Dockerfile, Wrangler config, frontend variables, or chat.

6. After deployment, open `https://YOUR_CLOUD_RUN_SERVICE_URL/health`. It must return JSON `{"ok":true}`. Also confirm logs say the backend connected to Turso. The health endpoint does not modify balances or trigger payouts.

## 2. Deploy the frontend to Cloudflare Pages

The current frontend uses TanStack Start. The Pages build enables its SPA mode and uses Nitro's static Cloudflare Pages preset. The application keeps client-side routing but moves all actual game API calls directly to Cloud Run. This avoids invoking a Pages Function for each game action.

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git** and select `hacker99a2z-oss/gramminer`.
2. Configure the Pages project:
   - **Production branch:** `main` (after PR #11 is merged).
   - **Root directory:** `frontend`.
   - **Build command:** `npm run build:pages`.
   - **Build output directory:** `dist`.
   - **Build environment variable:** `VITE_BACKEND_URL=https://YOUR_CLOUD_RUN_SERVICE_URL`.

   `VITE_BACKEND_URL` is a public API base URL, not a secret. It is bundled into browser code. Never put the Telegram bot token, Turso token, AdsGram secret, payout secret, or wallet mnemonic in a `VITE_*` variable.

3. In Pages > Settings > Variables and Secrets, add the runtime variable:
   - `BACKEND_URL` = the Cloud Run HTTPS service URL, without a trailing slash.

   This is used by the Pages Functions that proxy AdsGram reward callbacks and payout callbacks. The TonConnect manifest is generated directly in a small Pages Function. The game screen, mining, referral, donation and withdrawal API calls go straight from the browser to `VITE_BACKEND_URL`.

4. Once Pages gives you the production hostname (for example `https://gramminer.pages.dev`), update Cloud Run:
   - `FRONTEND_URL` = that exact origin.
   - `FRONTEND_URLS` = include the Pages production origin and old Vercel origin while rollback is needed.
   Deploy a new Cloud Run revision so CORS allows the Pages origin.

5. Test inside Telegram: game load, leaderboard, referrals, bonus, buy miner, claim miner, donation, AdsGram, withdrawal status, TonConnect manifest and navigation to `/refer`, `/donate` and `/withdraw`.

### Cloudflare Pages Free usage

- Requests for static assets are free and unlimited.
- Pages Functions requests count against the Workers Free allowance of 100,000 requests per day.
- The ordinary game API actions are sent directly to Cloud Run, not through Pages Functions. The retained callback/manifest proxy routes are the only Pages Functions expected to be used in normal operation.
- If you later add server-side application logic to Pages, those requests will use the Pages Functions allowance. Monitor usage before increasing dynamic routes.

## 3. Switch the Telegram webhook safely

Do this only after Cloud Run is healthy and the Pages frontend works.

1. In Cloud Run environment variables set `PUBLIC_BACKEND_URL` to the exact Cloud Run URL and set `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=true`.
2. Deploy one revision and check logs for `Telegram /start webhook configured`.
3. Immediately set `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=false` and deploy/update the revision. This avoids every new instance trying to register the webhook.
4. Send `/start` to the bot. Confirm the Open App button uses the new Pages URL and the welcome response is correct.
5. If the webhook must be rolled back, set the old Render URL as `PUBLIC_BACKEND_URL`, run the one-time registration again, then disable auto-configuration.

Keep the Render service online during the rollback window.

## 4. Move the payout scheduler and AdsGram callback

1. In GitHub repository Settings > Secrets and variables > Actions:
   - Keep the existing repository secret `PAYOUT_CRON_SECRET` (it must exactly match the Cloud Run secret).
   - Add repository **variable** `PAYOUT_BACKEND_URL` with the Cloud Run HTTPS service URL.
2. The updated workflow defaults to the old Render endpoint until `PAYOUT_BACKEND_URL` is set. Once Cloud Run is verified, set the variable and manually run **Actions > Gram Miner payout processor** once. Check that it reports success.
3. Update the AdsGram Reward URL to the new Pages URL:
   `https://YOUR_PAGES_HOST/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]`
   Keep the literal `[userId]` placeholder. The Pages route proxies to Cloud Run using the runtime `BACKEND_URL`; the Cloud Run secret must match the configured AdsGram secret.
4. Do not run multiple independent cron schedulers after cutover. The withdrawal lock helps prevent concurrent TON sends, but a single scheduler is easier to operate.

## 5. Final production cutover checklist

- [ ] Cloud Run `/health` returns 200.
- [ ] Cloud Run logs show Turso connection and no startup errors.
- [ ] Cloudflare Pages serves the SPA and direct asset URLs successfully.
- [ ] Pages deep links `/refer`, `/donate` and `/withdraw` load after a hard refresh.
- [ ] Game API calls use the Cloud Run URL and Cloud Run CORS allows the Pages origin.
- [ ] Telegram `/start` opens the new Pages URL.
- [ ] Login, mining, bonus, referral, donation, AdsGram callback and withdrawal status pass.
- [ ] TON wallet address, network and payout secret are verified. Use tiny/test transactions only.
- [ ] GitHub payout workflow calls Cloud Run and finishes successfully.
- [ ] Budget alerts are configured in Google Cloud. Budget alerts notify; they do not automatically stop service usage.
- [ ] Cloudflare Pages Function usage and Turso read/write/storage metrics are monitored.

Only after this checklist passes should you update Telegram's Main Mini App/Menu Button URL and treat the new stack as production. Keep Render and the old Vercel deployment available until the migration is stable.

## 6. Capacity and cost notes

This is a migration path, not a promise that 200,000–300,000 daily active users will run entirely for free. Cloud Run has monthly request/CPU/memory free allowances and separately billed usage beyond them. Cloudflare Pages static asset requests are free and unlimited, but Pages Functions are subject to the Workers Free daily request limit. Turso Free has monthly row-read/write and storage quotas. A realistic cost model requires measured API calls per active user, query row scans, write frequency, data-transfer volume and peak concurrency.

For the current game, the browser is never the source of truth for coins or withdrawable balances. Local storage may cache UI state only. Server-side Telegram verification and database transactions remain mandatory.

## 7. Existing production and rollback

The existing Render backend, Vercel frontend and Turso database are not deleted by this migration branch. Keep the existing provider environment variables and deployments until the Cloud Run/Pages stack is verified. Do not change the Turso URL or copy/migrate the production database; the Cloud Run backend must connect to the same existing Turso database.
Cloudflare Pages preview trigger test
