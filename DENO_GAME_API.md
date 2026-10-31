# Gram Miner — Deno Game API

This is the first isolated service in the staged API split. It handles only the core game routes below and reuses the existing game rules, Telegram Mini App authentication, and Turso/libSQL persistence code.

## Route ownership

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/game/load` | Authenticated player snapshot |
| POST | `/api/game/claim-bonus` | Daily bonus |
| POST | `/api/game/buy-miner` | Buy a miner |
| POST | `/api/game/claim-miner` | Claim mining reward |
| POST | `/api/game/donate` | Donate coins |
| GET | `/health` | Liveness check |
| GET | `/ready` | Turso connectivity check |

Ads, referral, leaderboard, withdrawal, payout and Telegram webhook routes are deliberately not exposed by this service. They remain on their current backend until their own adapters and tests are complete.

## Why this reuses the existing code

The Deno entrypoint imports the same `backend/lib/game.server.ts`, `backend/lib/db.server.ts`, `backend/lib/tg.core.ts` and `backend/lib/rules.ts` modules used by the current Worker/Node API. It does not fork game rules or create a second database schema.

Deno 2 supports npm dependencies declared in `package.json`, Node built-in modules such as `node:crypto`, and Node globals including `process`. The existing project dependencies include `@libsql/client`, `@ton/core` and `zod`; the database module uses the `@libsql/client/web` HTTP-compatible entrypoint. Deno-specific checks and tests run in GitHub Actions.

## Deno Deploy setup

Use the current Deno Deploy platform at https://console.deno.com (not the retired Deploy Classic dashboard). The current dashboard's GitHub integration does not yet support monorepos, and this repository contains both `backend/` and `frontend/`. To avoid configuring the wrong app root, create this service using the Deno Deploy CLI from the repository root and use a local-source app:

```sh
deno deploy create . \
  --org YOUR_DENO_ORG \
  --app gramminer-game \
  --source local \
  --runtime-mode dynamic \
  --entrypoint backend/deno/game-api.ts \
  --working-directory . \
  --install-command "deno install" \
  --build-timeout 10 \
  --build-memory-limit 1024 \
  --region global
```

Authenticate with `deno deploy` when prompted. This creates the app definition; it does not send live traffic from the Mini App to Deno. On subsequent local deployments from the repository root, use:

```sh
deno deploy --org YOUR_DENO_ORG --app gramminer-game
```

Do not use `--prod` for the first staging deployment. Configure environment variables in the Deno Deploy app's **Development/preview** context first. The entrypoint is relative to the repository root, and `deno.json` sets `nodeModulesDir: "auto"` so dependencies from the root `package.json` are resolved.

Set the following runtime environment variables in the **Development/preview** context first:

| Name | Type | Value |
|---|---|---|
| `TURSO_DATABASE_URL` | Secret or protected value | A dedicated **staging** Turso database URL |
| `TURSO_AUTH_TOKEN` | Secret | Token for that staging database only |
| `TELEGRAM_BOT_TOKEN` | Secret | Bot token only if testing real Telegram initData; preferably use a dedicated test bot |
| `FRONTEND_URL` | Plain text | Exact Cloudflare Pages/Vercel preview origin |
| `FRONTEND_URLS` | Plain text | Comma-separated exact preview origins |

Do not use production Turso credentials for this first Deno deployment. Do not add wallet mnemonics, payout cron secrets, TONCenter credentials, or AdsGram reward secrets to this Deno application. The core game routes do not need them.

6. Deploy and check `GET /health` and `GET /ready`. The health endpoint does not need credentials; readiness returns 503 until a valid staging Turso connection is configured.
7. Test with a dedicated Telegram test account and staging database: load, buy miner, claim miner when ready, daily bonus, and donation. Check duplicate claims and insufficient balance. Never perform these tests against production balances.

## Local Deno commands

Install Deno 2, then from the repository root:

```sh
deno task game-api:check
deno task game-api:test
deno task game-api:dev
```

The development task grants only environment and network permissions needed by this API. For live route tests, set the same staging-only environment variables in your local shell.

## Frontend cutover (not enabled yet)

After Deno has passed preview tests, set the Cloudflare Pages **Preview** build variable:

```text
VITE_GAME_API_URL=the exact preview URL shown by Deno Deploy
```

Redeploy the Pages preview and test the complete flow again. Keep this variable unset in Production until preview verification is signed off. The frontend then falls back to `VITE_BACKEND_URL` for all other services.

Once preview testing succeeds, configure the Deno app's production context with the approved production secrets and staging/production separation, deploy the production revision, then switch only the Production `VITE_GAME_API_URL` value and redeploy Pages. Keep the previous Worker/Render route available for rollback.

## Free plan capacity note

Deno Deploy's current Free plan lists 1 million inbound requests/month, 20 GiB egress, and 10 active CPU hours/month, plus memory-time and deployment limits. The CPU budget is only 600 minutes: at 3 million DAU, one daily request per user is already 3 million requests/month, exceeding the inbound request allowance before counting any other endpoints. Do not treat this free tier as a guarantee for 300K DAU.

Review current limits before launch: https://deno.com/deploy/pricing
