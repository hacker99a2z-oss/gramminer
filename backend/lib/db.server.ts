import { createClient, type Client } from "@libsql/client";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  tg_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT 'Miner',
  username TEXT,
  photo_url TEXT,
  coins INTEGER NOT NULL DEFAULT 0,
  balance_milli INTEGER NOT NULL DEFAULT 0,
  referred_by INTEGER,
  referral_claimed INTEGER NOT NULL DEFAULT 0,
  owns_miner2 INTEGER NOT NULL DEFAULT 0,
  last_bonus_date TEXT,
  last_ad_at TEXT,
  last_ad_session_id TEXT,
  donated_coins INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (referred_by) REFERENCES players(tg_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS players_referred_by_idx ON players(referred_by);
CREATE INDEX IF NOT EXISTS players_donated_idx ON players(donated_coins DESC);
CREATE TABLE IF NOT EXISTS miners (
  tg_id INTEGER NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
  miner_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  PRIMARY KEY (tg_id, miner_id)
);
CREATE INDEX IF NOT EXISTS miners_tg_idx ON miners(tg_id);
CREATE TABLE IF NOT EXISTS ad_sessions (
  tg_id INTEGER PRIMARY KEY REFERENCES players(tg_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  phase TEXT NOT NULL DEFAULT 'reserved',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL REFERENCES players(tg_id) ON DELETE RESTRICT,
  amount_milli INTEGER NOT NULL,
  nano TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  batch_id TEXT,
  proof_posted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS withdrawals_tg_idx ON withdrawals(tg_id, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals(status, created_at);
CREATE TABLE IF NOT EXISTS payout_batches (
  id TEXT PRIMARY KEY,
  seqno INTEGER NOT NULL,
  ids TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending'
);
CREATE TABLE IF NOT EXISTS locks (
  id TEXT PRIMARY KEY,
  until TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_file_cache (
  asset_key TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

let client: Client | undefined;
let initialized = false;
let initialization: Promise<void> | undefined;

export function getDb(): Client {
  if (client?.closed) {
    client = undefined;
    initialized = false;
  }
  if (client) return client;

  const url = process.env["TURSO_DATABASE_URL"];
  const authToken = process.env["TURSO_AUTH_TOKEN"];
  if (!url) throw new Error("TURSO_DATABASE_URL is missing. Set it in Render Environment Variables.");
  if (!url.startsWith("file:") && !authToken) {
    throw new Error("TURSO_AUTH_TOKEN is missing. Set it in Render Environment Variables.");
  }

  client = createClient({ url, ...(authToken ? { authToken } : {}) });
  return client;
}

export function closeDatabase(): void {
  client?.close();
  client = undefined;
  initialized = false;
  initialization = undefined;
}

async function ensureColumn(db: Client, table: string, column: string, definition: string) {
  // These identifiers are hard-coded here; no user input reaches this query.
  const info = await db.execute("PRAGMA table_info(" + table + ")");
  const exists = info.rows.some((row) => String((row as { name?: unknown }).name) === column);
  if (!exists) await db.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
}

export async function initializeDatabase(): Promise<void> {
  if (initialized) return;
  if (initialization) return initialization;

  initialization = (async () => {
    const db = getDb();
    await db.execute("PRAGMA foreign_keys = ON");
    await db.executeMultiple(SCHEMA_SQL);

    // Additive, idempotent migrations preserve existing player and payout records.
    await ensureColumn(db, "withdrawals", "proof_message_url", "TEXT");
    await ensureColumn(db, "withdrawals", "idempotency_key", "TEXT");
    await ensureColumn(db, "withdrawals", "tx_hash", "TEXT");
    await ensureColumn(db, "withdrawals", "body_hash", "TEXT");
    await ensureColumn(db, "withdrawals", "proof_attempts", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(db, "withdrawals", "proof_next_attempt_at", "TEXT");
    await ensureColumn(db, "payout_batches", "wallet_address", "TEXT");
    await ensureColumn(db, "payout_batches", "boc", "TEXT");
    await ensureColumn(db, "payout_batches", "tx_hash", "TEXT");
    await ensureColumn(db, "payout_batches", "last_broadcast_at", "TEXT");
    await ensureColumn(db, "payout_batches", "confirmed_at", "TEXT");
    await ensureColumn(db, "locks", "owner_token", "TEXT");
    await ensureColumn(db, "ad_sessions", "callback_blocked_until", "TEXT");

    // Existing databases cannot gain FOREIGN KEY clauses without table rebuilds.
    // Guard new writes with triggers as a compatible migration strategy.
    await db.executeMultiple(`
      CREATE INDEX IF NOT EXISTS withdrawals_proof_retry_idx
        ON withdrawals(status, proof_posted, proof_next_attempt_at);
      CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idempotency_idx
        ON withdrawals(tg_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS balance_ledger (
        id TEXT PRIMARY KEY,
        tg_id INTEGER NOT NULL,
        asset TEXT NOT NULL CHECK (asset IN ('coins', 'usd_milli')),
        entry_type TEXT NOT NULL,
        delta INTEGER NOT NULL CHECK (delta != 0),
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        reference_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS balance_ledger_tg_idx
        ON balance_ledger(tg_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS balance_ledger_reference_idx
        ON balance_ledger(tg_id, asset, entry_type, reference_id)
        WHERE reference_id IS NOT NULL;

      CREATE TRIGGER IF NOT EXISTS players_nonnegative_insert
      BEFORE INSERT ON players
      WHEN NEW.coins < 0 OR NEW.balance_milli < 0 OR NEW.donated_coins < 0
      BEGIN SELECT RAISE(ABORT, 'player balances cannot be negative'); END;
      CREATE TRIGGER IF NOT EXISTS players_nonnegative_update
      BEFORE UPDATE OF coins, balance_milli, donated_coins ON players
      WHEN NEW.coins < 0 OR NEW.balance_milli < 0 OR NEW.donated_coins < 0
      BEGIN SELECT RAISE(ABORT, 'player balances cannot be negative'); END;
      CREATE TRIGGER IF NOT EXISTS miners_valid_id_insert
      BEFORE INSERT ON miners
      WHEN NEW.miner_id < 1 OR NEW.miner_id > 5
      BEGIN SELECT RAISE(ABORT, 'invalid miner id'); END;
      CREATE TRIGGER IF NOT EXISTS miners_valid_id_update
      BEFORE UPDATE OF miner_id ON miners
      WHEN NEW.miner_id < 1 OR NEW.miner_id > 5
      BEGIN SELECT RAISE(ABORT, 'invalid miner id'); END;
      CREATE TRIGGER IF NOT EXISTS miners_player_insert
      BEFORE INSERT ON miners
      WHEN NOT EXISTS (SELECT 1 FROM players WHERE tg_id = NEW.tg_id)
      BEGIN SELECT RAISE(ABORT, 'miner owner does not exist'); END;
      CREATE TRIGGER IF NOT EXISTS ad_sessions_player_insert
      BEFORE INSERT ON ad_sessions
      WHEN NOT EXISTS (SELECT 1 FROM players WHERE tg_id = NEW.tg_id)
      BEGIN SELECT RAISE(ABORT, 'ad session owner does not exist'); END;
      CREATE TRIGGER IF NOT EXISTS withdrawals_player_insert
      BEFORE INSERT ON withdrawals
      WHEN NOT EXISTS (SELECT 1 FROM players WHERE tg_id = NEW.tg_id)
      BEGIN SELECT RAISE(ABORT, 'withdrawal owner does not exist'); END;
      CREATE TRIGGER IF NOT EXISTS balance_ledger_player_insert
      BEFORE INSERT ON balance_ledger
      WHEN NOT EXISTS (SELECT 1 FROM players WHERE tg_id = NEW.tg_id)
      BEGIN SELECT RAISE(ABORT, 'ledger owner does not exist'); END;
      CREATE TRIGGER IF NOT EXISTS withdrawals_valid_status_insert
      BEFORE INSERT ON withdrawals
      WHEN NEW.status NOT IN ('pending', 'sending', 'sent', 'failed', 'manual_review')
      BEGIN SELECT RAISE(ABORT, 'invalid withdrawal status'); END;
      CREATE TRIGGER IF NOT EXISTS withdrawals_valid_status_update
      BEFORE UPDATE OF status ON withdrawals
      WHEN NEW.status NOT IN ('pending', 'sending', 'sent', 'failed', 'manual_review')
      BEGIN SELECT RAISE(ABORT, 'invalid withdrawal status'); END;
    `);

    await db.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      args: [1, new Date().toISOString()],
    });
    await db.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      args: [2, new Date().toISOString()],
    });
    await db.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      args: [3, new Date().toISOString()],
    });
    await db.execute("SELECT 1");
    initialized = true;
  })();

  try {
    await initialization;
  } finally {
    initialization = undefined;
  }
}

export async function withWriteTransaction<T>(
  work: (tx: Awaited<ReturnType<Client["transaction"]>>) => Promise<T>,
): Promise<T> {
  const tx = await getDb().transaction("write");
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    if (!tx.closed) {
      try {
        await tx.rollback();
      } catch {
        // Preserve the original application/database error.
      }
    }
    throw error;
  }
}

export async function getTelegramCachedFileId(assetKey: string): Promise<string | null> {
  const result = await getDb().execute({
    sql: "SELECT file_id FROM telegram_file_cache WHERE asset_key = ?",
    args: [assetKey],
  });
  if (!result.rows.length) return null;
  return asText(asRow(result.rows[0])["file_id"]);
}

export async function setTelegramCachedFileId(assetKey: string, fileId: string): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO telegram_file_cache(asset_key, file_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(asset_key) DO UPDATE SET file_id = excluded.file_id, updated_at = excluded.updated_at`,
    args: [assetKey, fileId, new Date().toISOString()],
  });
}

export async function clearTelegramCachedFileId(assetKey: string): Promise<void> {
  await getDb().execute({
    sql: "DELETE FROM telegram_file_cache WHERE asset_key = ?",
    args: [assetKey],
  });
}

export function asRow(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export function asNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

export function asText(value: unknown): string {
  return String(value ?? "");
}
