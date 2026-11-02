CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  tg_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT 'Miner',
  username TEXT,
  photo_url TEXT,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  balance_milli INTEGER NOT NULL DEFAULT 0 CHECK (balance_milli >= 0),
  referred_by INTEGER REFERENCES players(tg_id) ON DELETE SET NULL,
  referral_claimed INTEGER NOT NULL DEFAULT 0,
  owns_miner2 INTEGER NOT NULL DEFAULT 0,
  last_bonus_date TEXT,
  last_ad_at TEXT,
  last_ad_session_id TEXT,
  donated_coins INTEGER NOT NULL DEFAULT 0 CHECK (donated_coins >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS players_referred_by_idx ON players(referred_by);
CREATE INDEX IF NOT EXISTS players_donated_idx ON players(donated_coins DESC);

CREATE TABLE IF NOT EXISTS miners (
  tg_id INTEGER NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
  miner_id INTEGER NOT NULL CHECK (miner_id BETWEEN 1 AND 5),
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
  verified_at TEXT,
  callback_blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL REFERENCES players(tg_id) ON DELETE RESTRICT,
  amount_milli INTEGER NOT NULL CHECK (amount_milli > 0),
  nano TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'manual_review')),
  batch_id TEXT,
  proof_posted INTEGER NOT NULL DEFAULT 0,
  proof_message_url TEXT,
  idempotency_key TEXT,
  tx_hash TEXT,
  body_hash TEXT,
  proof_attempts INTEGER NOT NULL DEFAULT 0,
  proof_next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS withdrawals_tg_idx ON withdrawals(tg_id, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals(status, created_at);
CREATE INDEX IF NOT EXISTS withdrawals_proof_retry_idx ON withdrawals(status, proof_posted, proof_next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idempotency_idx
  ON withdrawals(tg_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_batches (
  id TEXT PRIMARY KEY,
  seqno INTEGER NOT NULL,
  ids TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending',
  wallet_address TEXT,
  boc TEXT,
  tx_hash TEXT,
  last_broadcast_at TEXT,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS locks (
  id TEXT PRIMARY KEY,
  until TEXT NOT NULL,
  owner_token TEXT
);

CREATE TABLE IF NOT EXISTS balance_ledger (
  id TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL REFERENCES players(tg_id) ON DELETE RESTRICT,
  asset TEXT NOT NULL CHECK (asset IN ('coins', 'usd_milli')),
  entry_type TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta != 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reference_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS balance_ledger_tg_idx ON balance_ledger(tg_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS balance_ledger_reference_idx
  ON balance_ledger(tg_id, asset, entry_type, reference_id) WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_file_cache (
  asset_key TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
