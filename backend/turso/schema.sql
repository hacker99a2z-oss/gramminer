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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS players_referred_by_idx ON players(referred_by);
CREATE INDEX IF NOT EXISTS players_donated_idx ON players(donated_coins DESC);

CREATE TABLE IF NOT EXISTS miners (
  tg_id INTEGER NOT NULL,
  miner_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  PRIMARY KEY (tg_id, miner_id)
);
CREATE INDEX IF NOT EXISTS miners_tg_idx ON miners(tg_id);

CREATE TABLE IF NOT EXISTS ad_sessions (
  tg_id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  phase TEXT NOT NULL DEFAULT 'reserved',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL,
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
