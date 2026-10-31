# Gram Miner deployment and credentials

## Folder layout

- `frontend/`: UI, browser code, React components, pages, TanStack routes, SSR, Vercel config.
- `backend/`: JSON API, game logic, Turso database access, Telegram Bot API, TON payout logic.
- `backend/turso/schema.sql`: Turso/libSQL schema.
- `scripts/migrate-supabase-to-turso.mjs`: one-time data copy from the existing Supabase PostgreSQL database.
- Root: Render backend runtime package and Render Blueprint.

The runtime no longer uses Supabase. Telegram is called directly with your own BotFather token.

## Turso database setup

1. Create a Turso database in the Turso dashboard (choose a region close to Render's Singapore region when practical).
2. In the Turso database details, copy the database URL. It should start with `libsql://`.
3. Create a database auth token and copy it once.
4. Add both values to Render > gramminer-backend > Environment:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
5. The backend creates the required tables and indexes automatically at startup. Do not expose either value to the frontend.

## Move existing Supabase data before cutover

Keep the original Supabase project and its data until Turso has been verified. Do not delete or pause Supabase before the final validation.

1. Take a backup/export of the Supabase database.
2. Temporarily stop game writes (maintenance window) so the six source tables do not change while copying.
3. On a trusted local computer, use Node.js 22.18+ and install the root dependencies with `npm install`.
4. Set these two variables locally only:
   - `SUPABASE_DB_URL`: direct PostgreSQL connection string for the current Supabase database (the connection string must allow PostgreSQL connections).
   - `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`: the destination Turso credentials.
5. Run `npm run migrate:supabase-to-turso` from the repository root.
6. Check the reported row counts and verify balances, miners, referrals, ad sessions, withdrawals, payout batches and locks in Turso before switching production.
7. Set the Turso variables in Render and deploy. Keep the Supabase backup and credentials securely until the new app has passed end-to-end checks.

The importer uses parameterized writes and `INSERT OR IGNORE` primary-key handling so it can be safely re-run after an interrupted first import. It does not delete source data. Do not use it as a continuous two-way sync. Freeze source writes during the copy to get a consistent snapshot.

## Render backend

Keep Root Directory blank (repository root).

- Build Command: `npm install --omit=dev`
- Start Command: `npm run start:api`
- Health Check Path: `/health`

### Required backend variables

- `TURSO_DATABASE_URL`: Turso database URL.
- `TURSO_AUTH_TOKEN`: Turso database auth token. Backend-only.
- `TELEGRAM_BOT_TOKEN`: your bot token from @BotFather.
- `ADSGRAM_REWARD_SECRET`: random secret used to authenticate the AdsGram reward callback.
- `PAYOUT_CRON_SECRET`: a different random secret used to authenticate the payout callback.
- `TON_WALLET_MNEMONIC`: mnemonic for the dedicated TON payout wallet. Very sensitive.
- `FRONTEND_URL`: `https://gramminer-himu6.vercel.app`.

### Optional backend variables

- `FRONTEND_URLS`: comma-separated additional trusted frontend domains.
- `TONCENTER_API_KEY`: API key from @toncenter, optional for API limits.
- `TON_WALLET_VERSION`: `v5r1` (default) or `v4`, matching the payout wallet contract.
- `PAYMENT_PROOF_CHAT_ID`: channel username such as `@gramminer_payments` or a numeric chat ID.
- `PAYMENTS_PROOF_URL`: optional public payment-proof link.

### Payment proof channel and background payout schedule

To publish one proof message after each payout batch is marked sent:

1. Add the Telegram bot to your payment-proof channel as an administrator with permission to send messages.
2. Set Render variable `PAYMENT_PROOF_CHAT_ID` to the channel username (for example, `@gramminer_payments`) or numeric channel ID.
3. Set `PAYMENTS_PROOF_URL` to the channel's public link (for example, `https://t.me/gramminer_payments`) for the in-app proof link.
4. Configure an external scheduler to call the production frontend URL below every minute. Keep the secret private.

```text
https://gramminer-nine.vercel.app/api/public/payout?key=YOUR_PAYOUT_CRON_SECRET
```

The scheduler endpoint is authenticated by `PAYOUT_CRON_SECRET`. It processes pending payouts and checks in-flight batches; when a batch is marked sent, the backend posts a per-withdrawal proof to the configured channel. The Withdraw page refreshes open withdrawal statuses every 15 seconds while it remains open. The scheduled callback is what allows payout processing and channel posting to continue when no user has the Mini App open.

## Vercel frontend

Set the Vercel project's Root Directory to `frontend`. The server-side environment variable is:

- `BACKEND_URL=https://gramminer-backend.onrender.com`

Do not prefix this with `VITE_`; it must not enter browser JavaScript. No database credentials belong in Vercel.

## Telegram bot setup

1. Open [@BotFather](https://t.me/BotFather).
2. Use `/mybots` to choose the existing Gram Miner bot.
3. Copy its API token and add it to Render as `TELEGRAM_BOT_TOKEN`. Never paste it in chat or commit it to GitHub.
4. Configure the bot's Main Mini App or Menu Button URL to `https://gramminer-himu6.vercel.app`.
5. If posting payment proofs, add the bot to the proof channel as an administrator with permission to send messages.
6. Set Render variables: `PUBLIC_BACKEND_URL=https://gramminer-backend.onrender.com`, `BOT_APP_URL=https://gramminer-nine.vercel.app`, `BOT_OFFICIAL_CHANNEL_URL=https://t.me/your_channel`, and `BOT_SUPPORT_GROUP_URL=https://t.me/your_group`.
7. The backend registers its Telegram webhook on startup. A `/start` command sends the bundled welcome video followed by a six-sentence Bengali introduction and the Open App, Official Channel and Supported Group buttons. Configure the two Telegram links for those last two buttons to appear.

The backend uses the official Telegram Bot API and validates Telegram Mini App `initData` with bot-token HMAC-SHA-256.

## Generate callback secrets

Generate two independent random values (one for AdsGram and one for payout cron). For example, run `openssl rand -hex 32` twice on your own computer. Do not reuse a value.

AdsGram callback URL:
`https://play-for-win-bice.vercel.app/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]`

The AdsGram URL is a Vercel server route that proxies the request to the Render backend. In the AdsGram **Rewarded ad block** settings, set its optional **Reward URL** to the URL above, replacing `YOUR_ADSGRAM_REWARD_SECRET` with the exact value stored in Render as `ADSGRAM_REWARD_SECRET`. Keep the literal `[userId]` placeholder unchanged. Do not put this secret in frontend code or a `VITE_*` variable.

The ad itself is displayed by the AdsGram browser SDK inside the Mini App. The backend creates and marks a single-use ad session as started before the SDK is opened. The SDK's local completion event never credits coins. AdsGram documents the Reward URL as an additional GET callback after the user receives the rewarded completion on the client; it carries the Telegram `userId`. The Render backend checks the shared callback secret, user session, session phase, expiry, cooldown and duplicate status before crediting Turso. The frontend only polls `/api/game/ad-status` until the backend reports that callback as verified. Without a valid Reward URL callback, the user receives no coins. Note that AdsGram's documented callback carries a user ID, not a signed per-view event ID, so the callback is protected by the private URL secret and the backend's one-active-session/idempotency checks; it is not an independently signed proof payload.

Payout callback URL:
`https://gramminer-himu6.vercel.app/api/public/payout?key=YOUR_PAYOUT_CRON_SECRET`

Keep the AdsGram `[userId]` placeholder exactly as shown.

## TON payout wallet

Use a dedicated payout wallet, not your personal wallet. Store its mnemonic only in Render as `TON_WALLET_MNEMONIC`. Start on testnet or with tiny amounts, and verify the derived wallet address before enabling payouts. Never send the mnemonic through chat or commit it to GitHub.

## Security notes

Never commit real `.env` files, Turso auth tokens, PostgreSQL passwords, Telegram bot tokens, callback secrets, or wallet recovery phrases. Keep secrets in Render; only `BACKEND_URL` belongs in Vercel.
