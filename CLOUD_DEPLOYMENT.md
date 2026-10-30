# Gram Miner — Cloudflare deployment documents

The active backend deployment instructions are now in **[CLOUDFLARE_WORKERS.md](./CLOUDFLARE_WORKERS.md)**.

The old Cloud Run setup below has been superseded. Do not create or deploy a Cloud Run service for the current migration.

The Node Dockerfile and Render service are intentionally retained as rollback and TON payout infrastructure until the Cloudflare Worker has passed smoke testing. The existing Turso production database must remain unchanged.
