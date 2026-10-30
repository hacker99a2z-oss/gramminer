# Gram Miner deployment and credentials

## Folder layout

- `frontend/`: UI, browser code, React components, pages, TanStack routes, SSR, Vercel config.
- `backend/`: JSON API, game logic, database access, Telegram Bot API, TON payout logic, Supabase migration/schema.
- Root: Render backend runtime package, Render Blueprint and shared ignore rules.

There is no Lovable plugin, SDK, gateway, analytics, auth broker, or build config in this deployment. Telegram is called directly with your own BotFather token.

## Render backend

Keep Root Directory blank (repository root).

- Build Command: `npm install --omit=dev`
- Start Command: `npm run start:api`
- Health Check Path: `/health`

Set the backend variables in Render > gramminer-backend > Environment.

### Required backend variables

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key, or the newer `sb_secret_...` key. Backend-only.
- `TELEGRAM_BOT_TOKEN`: your bot token from @BotFather. There is no LOVABLE_API_KEY or TELEGRAM_API_KEY.
- `ADSGRAM_REWARD_SECRET`: randomly generated secret used to authenticate the AdsGram reward callback.
- `PAYOUT_CRON_SECRET`: a different random secret used to authenticate the payout callback.
- `TON_WALLET_MNEMONIC`: mnemonic for the dedicated TON payout wallet. Very sensitive.
- `FRONTEND_URL`: `https://gramminer-nine.vercel.app`.

### Optional backend variables

- `FRONTEND_URLS`: comma-separated additional trusted frontend domains.
- `TONCENTER_API_KEY`: API key from @toncenter, optional for API limits.
- `TON_WALLET_VERSION`: `v5r1` (default) or `v4`, matching the payout wallet contract.
- `PAYMENT_PROOF_CHAT_ID`: channel username such as `@gramminer_payments` or a numeric chat ID.
- `PAYMENTS_PROOF_URL`: optional public payment-proof link.

## Vercel frontend

Set the Vercel project's Root Directory to `frontend`. The Vercel server-side environment variable is:

- `BACKEND_URL=https://gramminer-backend.onrender.com`

Do not prefix this with `VITE_`; it is only used by server functions and must not enter browser JavaScript.

## Telegram bot setup

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot` and follow its prompts, or use `/mybots` to choose the existing Gram Miner bot.
3. Open the bot's API Token menu and copy the token.
4. Add the token as Render's `TELEGRAM_BOT_TOKEN`. Do not paste it in chat, GitHub, Vercel, or any frontend variable.
5. In BotFather configure the bot's Main Mini App or Menu Button URL to `https://gramminer-nine.vercel.app`.
6. If posting payment proofs, add the bot to the proof channel as an administrator with permission to send messages.

The backend uses the official Telegram Bot API directly for `getMe` and `sendMessage`, and validates Telegram Mini App `initData` with the bot-token HMAC-SHA-256 algorithm.

## Supabase credentials

1. Open your existing Supabase project (the one that contains the Gram Miner tables and `gm_*` SQL functions).
2. Copy its Project URL from the Connect dialog or Project Settings > API.
3. Copy its server-side Secret API key (`sb_secret_...`) or legacy service_role key from Settings > API Keys.
4. Set them in Render as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Do not use a publishable/anon key in the backend variable. Never expose a secret/service-role key in the frontend. Do not create a new database: keep the project that contains the existing game data.

## Generate callback secrets

Generate two independent random values (one for AdsGram and one for payout cron). For example run `openssl rand -hex 32` twice on your own computer. Do not reuse the same value for both variables.

Set the AdsGram secret in Render as `ADSGRAM_REWARD_SECRET`, and configure the same value in the AdsGram callback URL. Set the second value as `PAYOUT_CRON_SECRET`, and configure the payout scheduler URL to use it.

AdsGram callback URL:
`https://gramminer-nine.vercel.app/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]`

Payout callback URL:
`https://gramminer-nine.vercel.app/api/public/payout?key=YOUR_PAYOUT_CRON_SECRET`

AdsGram documents the Telegram user-ID placeholder as `[userId]`; keep this exact placeholder in the Reward URL.

## TON payout wallet

Create a dedicated wallet for payouts; do not use your personal wallet's recovery phrase. Export its mnemonic securely and store it only in Render as `TON_WALLET_MNEMONIC`. Fund the derived wallet address with the amount needed for testing and network fees. Never send the mnemonic through chat or commit it to GitHub. Start on testnet or with tiny mainnet test amounts and confirm the derived address is the wallet you intended before enabling payouts.

## Toncenter API key

Optional: message [@toncenter](https://t.me/toncenter), open Manage API Keys, and create a key. Add it to Render as `TONCENTER_API_KEY`. The app can call the public API without this key but may be rate limited.

## Local-only variables

`SUPABASE_DB_URL` is only needed if you later run database migrations from a trusted local computer. It is not required by the production app at runtime.

## Security notes

Never commit real `.env` files, bot tokens, Supabase secret keys, callback secrets, or wallet recovery phrases. Keep all secrets in Render, except `BACKEND_URL` which belongs in Vercel server-side Environment Variables.
