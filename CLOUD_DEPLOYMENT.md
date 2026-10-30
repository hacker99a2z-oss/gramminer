# Gram Miner cloud deployment guide

## Target architecture

- **Frontend:** Cloudflare Workers using the official TanStack Start/Vite integration. This app uses SSR, TanStack server functions and two server routes, so it is not a static-only Cloudflare Pages deployment.
- **Backend:** Google Cloud Run, running the existing Node.js 22 API.
- **Database:** Keep the existing Turso/libSQL database. Do not create a new database or migrate balances.
- **Payout schedule:** GitHub Actions calls the Cloud Run payout endpoint every 15 minutes. The existing Render service remains available for rollback until all checks pass.

Production traffic must only be switched after the Cloud Run and Workers deployments have been smoke-tested. Never run independent payout schedulers against different databases. The payout lock in Turso protects concurrent attempts, but duplicate scheduler calls waste capacity and complicate operations.

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
   - `FRONTEND_URL`: the new Workers URL, once created.
   - `FRONTEND_URLS`: comma-separated trusted frontend URLs. During migration include both the new Workers URL and old production frontend origin.
   - `PUBLIC_BACKEND_URL`: the Cloud Run HTTPS service URL shown in the Cloud Run service page.
   - `BOT_APP_URL`: the new Mini App URL.
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

## 2. Deploy the TanStack Start frontend to Cloudflare Workers

Cloudflare's official TanStack Start integration uses `@cloudflare/vite-plugin` and Wrangler. This is a Workers SSR deployment, **not** a Pages static-site deployment. The separate `vite.cloudflare.config.ts` preserves the existing Vercel/Nitro `vite.config.ts`, so merging this preparation does not intentionally switch Vercel's current build path. Static asset requests are separately unlimited on the Workers platform, but SSR and server-function requests count as Worker requests.

1. In the Cloudflare dashboard, enable Workers and create/login to your account.
2. From the repository's `frontend/` folder:

   ```sh
   npm install
   npx wrangler login
   npm run build:cloudflare
   npx wrangler deploy
   ```

3. In Workers & Pages > `gramminer-frontend` > Settings > Variables and Secrets, add the plain-text variable:
   - `BACKEND_URL` = the Cloud Run HTTPS service URL, without a trailing slash.

   This app's server functions read `process.env.BACKEND_URL`. The Wrangler compatibility date and Node.js compatibility setting in `wrangler.jsonc` enable access to configured Worker variables through `process.env`.

4. Assign a custom domain if available, or use the generated `https://gramminer-frontend.<account>.workers.dev` URL. Use that exact HTTPS origin as `FRONTEND_URL` and include it in `FRONTEND_URLS` on Cloud Run.

5. Visit the Worker URL and test game load, leaderboard, referrals, bonus, buy miner, claim miner, donation, withdrawal status, AdsGram status and TonConnect manifest. Do not test a real TON payment; use a test environment or a deliberately controlled tiny test withdrawal after verifying the wallet and payout lock.

### Workers Free vs Paid

- Workers Free allows 100,000 Worker requests per day and 10 ms CPU time per invocation. Static asset requests are free and unlimited.
- Workers Paid starts at $5/month and includes 10 million Worker requests/month plus 30 million CPU milliseconds; excess usage is charged separately.
- Each TanStack SSR/server-function request invokes the Worker. Therefore 200,000–300,000 daily active users cannot be assumed to fit the Free request allowance. Move to Workers Paid before the daily cap is reached; do not wait for a production outage.

## 3. Switch the Telegram webhook safely

Do this only after Cloud Run is healthy and the Workers frontend works.

1. In Cloud Run environment variables set `PUBLIC_BACKEND_URL` to the exact Cloud Run URL and set `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=true`.
2. Deploy one revision and check logs for `Telegram /start webhook configured`.
3. Immediately set `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=false` and deploy/update the revision. This avoids every new instance trying to register the webhook.
4. Send `/start` to the bot. Confirm the Open App button uses the new Workers URL and the welcome response is correct.
5. If the webhook must be rolled back, set the old Render URL as `PUBLIC_BACKEND_URL`, run the one-time registration again, then disable auto-configuration.

Keep the Render service online during the rollback window.

## 4. Move the payout scheduler and AdsGram callback

1. In GitHub repository Settings > Secrets and variables > Actions:
   - Keep the existing repository secret `PAYOUT_CRON_SECRET` (it must exactly match the Cloud Run secret).
   - Add repository **variable** `PAYOUT_BACKEND_URL` with the Cloud Run HTTPS service URL.
2. The updated workflow defaults to the old Render endpoint until `PAYOUT_BACKEND_URL` is set. Once Cloud Run is verified, set the variable and manually run **Actions > Gram Miner payout processor** once. Check that it reports success.
3. Update the AdsGram Reward URL to:
   `https://YOUR_CLOUD_RUN_SERVICE_URL/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]`
   Keep the literal `[userId]` placeholder. The secret must match the Cloud Run `ADSGRAM_REWARD_SECRET`.
4. Do not run multiple independent cron schedulers after cutover. The withdrawal lock helps prevent concurrent TON sends, but a single scheduler is easier to operate.

## 5. Final production cutover checklist

- [ ] Cloud Run `/health` returns 200.
- [ ] Cloud Run logs show Turso connection and no startup errors.
- [ ] Worker frontend loads inside Telegram.
- [ ] Telegram `/start` opens the new Workers URL.
- [ ] Login, mining, bonus, referral, donation, AdsGram callback and withdrawal status pass.
- [ ] TON wallet address, network and payout secret are verified. Use tiny/test transactions only.
- [ ] GitHub payout workflow calls Cloud Run and finishes successfully.
- [ ] Cloud Run CORS `FRONTEND_URLS` contains the new frontend origin (and old origin during rollback).
- [ ] Budget alerts are configured in Google Cloud. Budget alerts notify; they do not automatically stop service usage.
- [ ] Cloudflare Workers request usage and Turso read/write/storage metrics are monitored.

Only after this checklist passes should you update Telegram's Main Mini App/Menu Button URL and treat the new stack as production. Keep Render and the old Vercel deployment available until the migration is stable.

## 6. Capacity and cost notes

This is a migration path, not a promise that 200,000–300,000 daily active users will run for free. Cloud Run has a monthly request/CPU/memory free allowance and separately billed usage beyond it. Cloudflare Workers Free has a daily request cap. Turso Free has monthly row-read/write and storage quotas. A realistic cost model requires measured API calls per active user, query row scans, write frequency, data-transfer volume and peak concurrency.

For the current game, the browser is never the source of truth for coins or withdrawable balances. IndexedDB/local storage may cache UI state only. Server-side Telegram verification and database transactions remain mandatory.

## 7. Existing production and rollback

The existing Render backend, Vercel frontend and Turso database are not deleted by this migration branch. Keep the existing provider environment variables and deployments until the Cloud Run/Workers stack is verified. Do not change the Turso URL or copy/migrate the production database; the Cloud Run backend must connect to the same existing Turso database.
