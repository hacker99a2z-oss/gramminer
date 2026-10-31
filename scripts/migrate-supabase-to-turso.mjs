import { createClient } from "@libsql/client";
import pg from "pg";
import { readFile } from "node:fs/promises";

const { Pool } = pg;
const sourceUrl = process.env.SUPABASE_DB_URL;
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!sourceUrl) throw new Error("Set SUPABASE_DB_URL to the existing Supabase PostgreSQL connection string.");
if (!tursoUrl || !tursoToken) throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");

const source = new Pool({ connectionString: sourceUrl, max: 2 });
const destination = createClient({ url: tursoUrl, authToken: tursoToken });
const schema = await readFile(new URL("../backend/turso/schema.sql", import.meta.url), "utf8");

const tables = [
  {
    name: "players",
    order: "tg_id",
    columns: ["tg_id", "first_name", "username", "photo_url", "coins", "balance_milli", "referred_by", "referral_claimed", "owns_miner2", "last_bonus_date", "last_ad_at", "last_ad_session_id", "donated_coins", "created_at"],
    map: (r) => [String(r.tg_id), r.first_name, r.username, r.photo_url, String(r.coins), String(r.balance_milli), r.referred_by === null ? null : String(r.referred_by), r.referral_claimed ? 1 : 0, r.owns_miner2 ? 1 : 0, r.last_bonus_date ? String(r.last_bonus_date).slice(0, 10) : null, iso(r.last_ad_at), r.last_ad_session_id, String(r.donated_coins), iso(r.created_at)],
  },
  {
    name: "miners",
    order: "tg_id, miner_id",
    columns: ["tg_id", "miner_id", "started_at"],
    map: (r) => [String(r.tg_id), r.miner_id, iso(r.started_at)],
  },
  {
    name: "ad_sessions",
    order: "tg_id",
    columns: ["tg_id", "session_id", "status", "phase", "created_at", "expires_at", "verified_at"],
    map: (r) => [String(r.tg_id), r.session_id, r.status, r.phase, iso(r.created_at), iso(r.expires_at), iso(r.verified_at)],
  },
  {
    name: "withdrawals",
    order: "id",
    columns: ["id", "tg_id", "amount_milli", "nano", "address", "status", "batch_id", "proof_posted", "created_at", "sent_at"],
    map: (r) => [r.id, String(r.tg_id), String(r.amount_milli), String(r.nano), r.address, r.status, r.batch_id, r.proof_posted ? 1 : 0, iso(r.created_at), iso(r.sent_at)],
  },
  {
    name: "payout_batches",
    order: "id",
    columns: ["id", "seqno", "ids", "sent_at", "status"],
    map: (r) => [r.id, r.seqno, JSON.stringify(r.ids ?? []), iso(r.sent_at), r.status],
  },
  {
    name: "locks",
    order: "id",
    columns: ["id", "until"],
    map: (r) => [r.id, iso(r.until)],
  },
];

function iso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

async function insertRows(table, rows) {
  const placeholders = table.columns.map(() => "?").join(", ");
  const sql = "INSERT OR IGNORE INTO " + table.name + " (" + table.columns.join(", ") + ") VALUES (" + placeholders + ")";
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100).map((row) => ({
      sql,
      args: table.map(row),
    }));
    if (batch.length) await destination.batch(batch, "write");
  }
}

async function countRows(client, table) {
  const result = await client.execute("SELECT COUNT(*) AS count FROM " + table);
  return BigInt(String(result.rows[0].count));
}

try {
  await destination.executeMultiple(schema);
  let total = 0;

  for (const table of tables) {
    const sourceCountResult = await source.query("SELECT COUNT(*)::text AS count FROM " + table.name);
    const expectedCount = BigInt(sourceCountResult.rows[0].count);
    let offset = 0;
    let readCount = 0;

    while (true) {
      const result = await source.query(
        "SELECT * FROM " + table.name + " ORDER BY " + table.order + " LIMIT 500 OFFSET $1",
        [offset],
      );
      if (!result.rows.length) break;
      await insertRows(table, result.rows);
      readCount += result.rows.length;
      offset += result.rows.length;
    }

    const actualCount = await countRows(destination, table.name);
    if (readCount !== expectedCount || actualCount !== expectedCount) {
      throw new Error(
        table.name + " verification failed: source=" + expectedCount +
        ", read=" + readCount + ", destination=" + actualCount +
        ". Keep Supabase active and investigate before cutover.",
      );
    }

    total += readCount;
    process.stdout.write(table.name + ": verified " + actualCount + " rows\n");
  }

  const sourceBalances = await source.query(
    "SELECT COALESCE(SUM(coins), 0)::text AS coins, COALESCE(SUM(balance_milli), 0)::text AS balance_milli, COALESCE(SUM(donated_coins), 0)::text AS donated_coins FROM players",
  );
  const destinationBalances = await destination.execute(
    "SELECT COALESCE(SUM(coins), 0) AS coins, COALESCE(SUM(balance_milli), 0) AS balance_milli, COALESCE(SUM(donated_coins), 0) AS donated_coins FROM players",
  );
  for (const field of ["coins", "balance_milli", "donated_coins"]) {
    const expected = BigInt(sourceBalances.rows[0][field]);
    const actual = BigInt(String(destinationBalances.rows[0][field]));
    if (expected !== actual) {
      throw new Error("Balance verification failed for " + field + ": source=" + expected + ", Turso=" + actual);
    }
  }

  process.stdout.write(
    "Migration verified: " + total +
    " rows copied; total coins, withdraw balance and donated coins match.\n",
  );
} finally {
  try {
    await source.end();
  } finally {
    destination.close();
  }
}
