# Gram Miner Backend

Standalone Node.js API for Gram Miner. The backend uses Turso/libSQL for players, miners, AdsGram sessions, withdrawals, payout batches and worker locks.

The Render service is built from the repository root. It initializes the Turso schema at startup and runs with `npm run start:api`. See the root `DEPLOYMENT.md` for database creation, optional legacy Supabase data import, secrets and cutover instructions.
