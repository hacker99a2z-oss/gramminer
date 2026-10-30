# Gram Miner deployment

## Architecture

- **Vercel** serves the existing TanStack Start frontend and SSR routes.
- **Render** runs the standalone API in \`backend/server.ts\`.
- Vercel server functions proxy game requests to Render using the server-only \`BACKEND_URL\` variable. The browser does not receive this variable.
- Telegram initData verification, Supabase service-role access, game rules, SQL RPC calls, AdsGram verification, TON payout batching, and Telegram proof posting remain on the backend.
- **Supabase PostgreSQL stays as the database.** Its tables and SECURITY DEFINER \`gm_*\` SQL functions are required for the current atomic balance and withdrawal logic.

## Deploy the backend to Render

1. Create a Render **Blueprint** from this repository and keep the repository root as the Root Directory.
2. Render reads \`render.yaml\`, installs the runtime dependencies, starts \`backend/server.ts\`, and checks \`/health\`.
3. In the Render service environment, set the values listed below. Do not commit real values to GitHub.

Required:
- \`SUPABASE_URL\`
- \`SUPABASE_SERVICE_ROLE_KEY\`
- \`LOVABLE_API_KEY\` and \`TELEGRAM_API_KEY\` (the existing Telegram connector gateway credentials)
- \`ADSGRAM_REWARD_SECRET\`
- \`PAYOUT_CRON_SECRET\`
- \`TON_WALLET_MNEMONIC\`
- \`FRONTEND_URL\` (your production Vercel URL)

Optional:
- \`TONCENTER_API_KEY\`
- \`TON_WALLET_VERSION\` (defaults to \`v5r1\`)
- \`PAYMENT_PROOF_CHAT_ID\`
- \`PAYMENTS_PROOF_URL\`

After deployment, verify that \`https://YOUR-RENDER-SERVICE.onrender.com/health\` returns \`{"ok":true}\`.

## Deploy the frontend to Vercel

1. Import this same Git repository into Vercel.
2. Keep the Root Directory at the repository root and use the TanStack Start framework preset (also declared in \`vercel.json\`).
3. Add \`BACKEND_URL=https://YOUR-RENDER-SERVICE.onrender.com\` to Vercel Environment Variables. Do not prefix it with \`VITE_\`.
4. Deploy and confirm the home, donate, refer, and withdraw routes load.

## External integrations

- Set the Telegram Mini App URL/domain to the Vercel production URL.
- Set the AdsGram reward callback URL to \`https://YOUR-VERCEL-DOMAIN/api/public/adsgram/reward\`. The Vercel route forwards the callback to Render without exposing the reward secret.
- Keep the existing payout cron URL at \`https://YOUR-VERCEL-DOMAIN/api/public/payout?key=YOUR_PAYOUT_CRON_SECRET\`, or call the matching path on Render directly.
- The TonConnect manifest remains served from Vercel so its \`url\` and icon origin match the Mini App.

## Secrets

Only \`BACKEND_URL\` belongs in Vercel. All database, Telegram connector, AdsGram, payout, and wallet secrets belong in Render. \`SUPABASE_DB_URL\` is for local migration tooling only. The \`.env.example\` file contains names and placeholders, never real credentials.

## Database choice

Keep the existing Supabase PostgreSQL database. The current app relies on PostgreSQL tables, RLS, and atomic SQL functions; changing to MongoDB would require rewriting and retesting all balance, referral, reward, and withdrawal transactions. Supabase also includes a separate 1 GB file-storage allowance on its free plan, while the current app stores its game state in database rows and does not upload user files there.

## Free-tier caveats

Render Free web services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Supabase Free projects pause after one week of inactivity. These limits can affect the first request and payout timing; use paid always-on hosting for production money-handling workloads.
