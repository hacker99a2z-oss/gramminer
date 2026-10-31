# Gram Miner — Cloudflare CDN + Workers, Render for background operations

## The only two application platforms

1. **Cloudflare CDN + Pages + Workers:** serves the Telegram Mini App, terminates public API traffic at the edge, validates user actions, applies game rules, and reads/writes the existing Turso database.
2. **Render:** stays as the private-in-purpose Node service for TON payout signing/batching, payout proof posting and the Telegram bot webhook handler.

Turso remains the existing authoritative database. It is not a third application server. Do not create Deno Deploy, Supabase Functions, Appwrite Functions, Cloud Run, or a second backend for this architecture.

## Request path

- Static frontend, images, JS and CSS: Telegram Mini App → Cloudflare Pages CDN.
- Game/API: Mini App → Cloudflare Worker → Telegram initData validation → existing Turso database.
- Telegram webhook and scheduled payout calls: caller → Cloudflare Worker → fixed, allowlisted Render origin path.
- TON wallet signing and payout confirmation: Render only. Do not put wallet mnemonic or TONCenter signing credentials in Cloudflare Worker secrets.

The Worker proxies exactly two Render paths: `POST /api/telegram/webhook` and `GET /api/public/payout`. It is not an open URL proxy. The payout proxy validates the scheduled request with `PAYOUT_CRON_SECRET` before forwarding it to Render with an Authorization bearer header. All proxied responses are `no-store`.

## Secure gameplay batch synchronization

The Mini App now queues only command intent for these gameplay actions:

- daily bonus claim
- miner purchase
- miner reward claim
- donation
- referral reward claim

It groups actions for up to 1.2 seconds, sends a checkpoint every 15 seconds while the app stays open, and sends a final best-effort batch using `sendBeacon`/keepalive when the page becomes hidden or closes. The local queue is persisted per Telegram account; Telegram initData itself is not stored in localStorage. The app retries unacknowledged commands after reopening.

The batch is capped at 20 commands. The server verifies Telegram initData, validates a strict schema, derives every coin debit/reward from server-side rules, checks ownership and eligibility, and writes each action in a Turso write transaction. A per-user action receipt makes retries idempotent: sending the same action ID again cannot credit/debit twice. The server returns the real database snapshot; browser balances are never accepted as input.

**Important browser limitation:** closing a WebView does not guarantee that JavaScript gets time to send a final network request. The design therefore does not rely on exit alone: it also persists the queue and checkpoints while the app is open. A user who force-kills the app while offline may not sync until reopening with a connection.

Withdrawals, AdsGram session start/verification, and payout operations remain immediate server-verified flows. They are not deferred to an exit batch because they involve external providers, money movement, or time-sensitive state. Mining start time is assigned by the server when the batch commits, never from a client-supplied timestamp.

## CDN caching policy

| Data | Cache policy |
|---|---|
| Static Pages assets | Cloudflare Pages CDN |
| Public leaderboard | Cloudflare edge cache for 15 seconds; stale-while-revalidate 30 seconds |
| Player profile, coins, balance, miners | `no-store`; never shared-cache |
| Buy/claim/donate/referral sync | `no-store`; POST only |
| Withdrawal, AdsGram verification, Telegram webhook, payout | `no-store` |

Never cache authenticated responses or any response that includes a player's private balance.

## 1. Deploy the Worker

Cloudflare Dashboard → **Workers & Pages** → create/connect the `hacker99a2z-oss/gramminer` repository.

- Root directory: repository root.
- Branch: `main` after the preview branch is verified.
- Worker entrypoint: `backend/worker.ts`.
- Build command: `npm install --no-audit --no-fund && npm run build:worker`.
- Deploy command, if requested: `npx wrangler deploy`.
- Worker name: `gramminer-backend`.

The Worker is the public API entrypoint. Use its exact `workers.dev` URL or a custom hostname on a Cloudflare-managed zone. If using a custom hostname, keep the DNS record proxied through Cloudflare and attach the Worker route/custom domain in the Cloudflare dashboard.

## 2. Cloudflare Worker environment

Set plain-text variables:

| Name | Value |
|---|---|
| `RENDER_BACKEND_URL` | `https://gramminer-backend.onrender.com` |
| `FRONTEND_URL` | `https://gramminer-c68.pages.dev` |
| `FRONTEND_URLS` | Production and preview Pages origins, comma-separated |
| `BOT_APP_URL` | `https://gramminer-c68.pages.dev` |
| `TURSO_DATABASE_URL` | Existing Turso URL |
| `PAYMENT_PROOF_CHAT_ID` | Existing channel ID, if configured |
| `PAYMENTS_PROOF_URL` | Existing public proof channel URL, if configured |

Set these as **Worker Secrets**:

- `TURSO_AUTH_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `ADSGRAM_REWARD_SECRET`
- `PAYOUT_CRON_SECRET` — same random value currently configured on Render and as the GitHub Actions secret.

Do not put `TON_WALLET_MNEMONIC`, `TONCENTER_API_KEY`, or any wallet recovery phrase in Workers, Pages build variables, or browser code.

## 3. Cloudflare Pages frontend

Keep the existing Pages frontend project and connect its build to this repository's `frontend` directory.

Set in both Preview and Production:

- `VITE_BACKEND_URL` = the exact Worker URL/custom hostname from step 1.
- `BACKEND_URL` = the same Worker URL; Pages Functions use it for the AdsGram callback proxy.

Do not configure `VITE_GAME_API_URL`, `VITE_ADS_API_URL`, `VITE_REFERRAL_API_URL`, `VITE_LEADERBOARD_API_URL`, or `VITE_FINANCE_API_URL`. Those separate-provider overrides have been removed. Redeploy Pages after changing `VITE_BACKEND_URL`, because it is embedded in the browser build.

## 4. Render configuration

Keep the existing Render service `gramminer-backend` and its existing Turso database. Do not create a second Render service or database.

Keep these secrets on Render:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `ADSGRAM_REWARD_SECRET` only if required by an existing direct/legacy callback path
- `PAYOUT_CRON_SECRET`
- `TON_WALLET_MNEMONIC`
- `TONCENTER_API_KEY` (if used)

Set `PUBLIC_BACKEND_URL` on Render to the exact Worker URL/custom hostname. Set `BOT_APP_URL` to `https://gramminer-c68.pages.dev`. After the Worker proxy and Render origin have been deployed, enable `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=true` for one controlled restart so Telegram registers `/api/telegram/webhook` through Cloudflare. Then set it back to `false` or remove it.

The Worker must have `RENDER_BACKEND_URL=https://gramminer-backend.onrender.com`. Telegram's webhook secret header is forwarded unchanged; Render still validates the Telegram webhook secret itself.

AdsGram Reward URL should point to the Cloudflare Pages Function, which proxies to the Worker:

```text
https://gramminer-c68.pages.dev/api/public/adsgram/reward?key=YOUR_ADSGRAM_REWARD_SECRET&userid=[userId]
```

Keep the literal `[userId]` placeholder. The reward secret is verified by the Worker; never put it in frontend JavaScript or a `VITE_*` variable.

## 5. Scheduled payouts through Cloudflare

The GitHub Actions payout workflow should call the Worker URL, not the Render URL, so scheduled inbound requests also pass through Cloudflare:

- Set repository variable `PAYOUT_BACKEND_URL` to `https://gramminer-c68.pages.dev`. The Pages Function proxies `/api/public/payout` to the Worker, which validates the cron bearer token and forwards to Render.
- Keep repository secret `PAYOUT_CRON_SECRET` equal to the value on both Render and Worker.
- The Worker verifies the bearer secret and forwards the request to Render. Render performs the payout lock, TON signing, transfer confirmation and proof posting.

The Render origin remains directly addressable on its `onrender.com` hostname. After the Worker and Pages cutover has passed all smoke tests, set Render's `EDGE_ONLY_API=true` so direct requests to legacy `/api/game/*` and AdsGram reward routes are rejected. Leave this switch off until that cutover is complete, to preserve rollback. The payout secret must remain strong and must never appear in frontend code. The app itself must never call Render directly.

## 6. Security and cache controls

- Worker verifies Telegram initData on every authenticated gameplay batch.
- Every balance-changing action is calculated and committed server-side.
- Batch IDs are idempotent per Telegram user and stored in Turso receipts.
- Requests containing balance/profile state use `Cache-Control: no-store`.
- Only public leaderboard data is cached at the Cloudflare edge.
- Configure Cloudflare WAF/rate-limiting rules for the Worker hostname if it is attached to a Cloudflare-managed zone. Rate-limit suspicious repeated auth failures and abusive callback traffic; do not put a low blanket threshold on legitimate gameplay.
- Keep Render's wallet secrets and payout executor separate from the Worker.
- Do not load-test production balances. Use a separate staging Turso database and test Telegram account first.

## 7. Required smoke tests before production cutover

1. Open the Cloudflare Pages Preview Mini App inside Telegram.
2. Confirm `GET /health` and `GET /ready` on the Worker.
3. Buy a miner, claim an eligible miner, claim daily bonus, donate, and claim an eligible referral; verify the authoritative Turso snapshot matches.
4. Repeat a batch request with the same action IDs and confirm the receipt marks duplicates without changing balances twice.
5. Close the app with queued actions, reopen it, and confirm the persisted queue is replayed once.
6. Confirm a forged action with an invalid miner ID, unknown referral, duplicate bonus, or insufficient coins cannot change balances.
7. Verify AdsGram's server callback and withdrawal flow separately. Use test balances only; do not send real TON during smoke tests.
8. Run a payout workflow manually with the staging wallet/database before production.
9. Verify Telegram `/start` reaches Render through the Worker proxy and sends the welcome reply.\n10. Only after all preceding tests pass, set Render `EDGE_ONLY_API=true`; verify legacy Render game routes now return 403 while Worker game routes continue working.

A successful CI build is not proof of 300,000 DAU capacity. Cloudflare Workers Free currently has a 100,000 request/day ceiling and a 10 ms CPU budget per HTTP invocation. One request per user per day at 300,000 DAU already exceeds that daily free request allowance. Measure API requests/user, database reads/writes, p95 latency, CPU, and peak concurrency before choosing a paid capacity plan.

## Rollback

If the Worker preview fails, revert only the Cloudflare Pages `VITE_BACKEND_URL`/ `BACKEND_URL` values to the currently working backend URL and redeploy Pages. Keep Render and the existing Turso database intact. Never delete production player or payout data during a rollback.
