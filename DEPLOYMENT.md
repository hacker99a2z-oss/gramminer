# Gram Miner deployment

The current production architecture is **Cloudflare Pages/CDN + Cloudflare Workers + Render + the existing Turso database**.

Use the current guides below:

1. [Cloudflare Pages and Workers deployment](./CLOUDFLARE_WORKERS.md) — frontend hosting, public game API, Worker variables/secrets, cache policy, webhook and payout proxy routing.
2. [Render setup](./RENDER_SETUP.md) — the existing `gramminer-backend` service, required Node commands, Telegram bot webhook, TON wallet secrets, and payout schedule.
3. [Production cutover checklist](./PRODUCTION_CUTOVER_CHECKLIST.md) — staging database, preview deployments, smoke tests, production environment and rollback sequence.

## Service responsibility summary

| Service | Responsibility |
|---|---|
| Cloudflare Pages/CDN | Frontend app and static assets |
| Cloudflare Workers | Public game API, auth, validation, rate controls, public leaderboard cache |
| Render Node service | Telegram webhook, TON payout executor, proof posting |
| Turso | Authoritative player and payout database |

Do not create Deno Deploy, Supabase Edge Functions, Appwrite Functions, Cloud Run, another backend, or a second game database for this architecture.

Never put Turso tokens, Telegram bot tokens, AdsGram/payout secrets, TONCenter signing keys or wallet mnemonics in frontend code or `VITE_*` variables. Keep wallet signing material on Render only.

Render is connected to `main` with Auto Deploy enabled. Changes to the Render service's runtime code can restart the live backend, so follow the staging and smoke-test checklist before changing production settings.
