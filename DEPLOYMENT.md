# Gram Miner deployment entrypoint

The current supported deployment uses **Cloudflare Pages/CDN + Cloudflare Workers** for the Mini App and all user-facing game API requests, with the existing **Render** service reserved for Telegram webhook handling and TON payout execution.

Follow [CLOUDFLARE_WORKERS.md](./CLOUDFLARE_WORKERS.md) for the only current deployment procedure, environment variables, CDN cache policy, secure action batching, Render proxy routing, staged cutover and rollback.

Do not follow older Vercel, Deno Deploy, Supabase Functions, Appwrite Functions, Cloud Run, or multi-backend API-routing instructions for the current architecture.

## Security rules

- Turso remains the only source of truth for player coins, withdrawable balances, miners, referrals and withdrawals.
- The browser submits action intent only. The server computes and validates all values.
- Do not put Telegram bot tokens, AdsGram callback secrets, payout secrets, TONCenter credentials or wallet mnemonics in frontend build variables.
- Do not enable Render `EDGE_ONLY_API=true` until the Cloudflare Worker and Pages preview flows have passed the documented smoke tests.
