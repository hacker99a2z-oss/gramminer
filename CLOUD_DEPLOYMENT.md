# Gram Miner — Cloud deployment

The current architecture and deployment guide is [CLOUDFLARE_WORKERS.md](./CLOUDFLARE_WORKERS.md).

It uses Cloudflare Pages/CDN and Workers for the public Mini App and API, Render for the Telegram webhook and TON payout service, and the existing Turso database as the authoritative game store. No Deno Deploy, Supabase Functions, Appwrite Functions, Cloud Run, or additional API hosting is required.
