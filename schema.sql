-- Loop — schema for Cloudflare D1 (SQLite).
-- Safe to re-run: every statement is IF NOT EXISTS.
--
-- Money is always an INTEGER count of luna (1 NIM = 100,000 luna).
-- Timestamps are INTEGER milliseconds since the epoch.
-- Addresses are canonical Nimiq addresses, uppercase with no spaces.

CREATE TABLE IF NOT EXISTS users (
  address       TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  avatar_seed   INTEGER NOT NULL,
  public_key    TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

-- Login challenges. Single use, short lived, deleted once redeemed.
CREATE TABLE IF NOT EXISTS challenges (
  nonce       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON challenges (expires_at);

-- Sessions. We store only a SHA-256 of the bearer token, so a database dump
-- does not hand anybody a working session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  address     TEXT NOT NULL REFERENCES users (address),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_address ON sessions (address);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS tabs (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  emoji        TEXT NOT NULL DEFAULT '🧾',
  invite_code  TEXT NOT NULL UNIQUE,
  created_by   TEXT NOT NULL REFERENCES users (address),
  created_at   INTEGER NOT NULL,
  archived     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tabs_invite ON tabs (invite_code);

CREATE TABLE IF NOT EXISTS tab_members (
  tab_id     TEXT NOT NULL REFERENCES tabs (id) ON DELETE CASCADE,
  address    TEXT NOT NULL REFERENCES users (address),
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (tab_id, address)
);
CREATE INDEX IF NOT EXISTS idx_tab_members_address ON tab_members (address);

CREATE TABLE IF NOT EXISTS expenses (
  id             TEXT PRIMARY KEY,
  tab_id         TEXT NOT NULL REFERENCES tabs (id) ON DELETE CASCADE,
  payer          TEXT NOT NULL REFERENCES users (address),
  amount_luna    INTEGER NOT NULL CHECK (amount_luna > 0),
  description    TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'general',
  fiat_currency  TEXT,
  fiat_amount    REAL,
  fiat_rate      REAL,
  created_by     TEXT NOT NULL REFERENCES users (address),
  created_at     INTEGER NOT NULL,
  voided         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expenses_tab ON expenses (tab_id, created_at DESC);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id  TEXT NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
  address     TEXT NOT NULL REFERENCES users (address),
  share_luna  INTEGER NOT NULL CHECK (share_luna >= 0),
  PRIMARY KEY (expense_id, address)
);

-- Real NIM payments between members. Nothing else lives here: the netting and
-- ring-cancellation are recomputed live from expenses, so they can never drift
-- out of sync with reality.
--
-- One payment can clear debt across several tabs, so it becomes several rows
-- sharing a batch_id and a tx_hash. That keeps every tab's own balance true.
CREATE TABLE IF NOT EXISTS transfers (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'settlement' CHECK (kind IN ('settlement')),
  from_addr     TEXT NOT NULL REFERENCES users (address),
  to_addr       TEXT NOT NULL REFERENCES users (address),
  amount_luna   INTEGER NOT NULL CHECK (amount_luna > 0),
  tab_id        TEXT REFERENCES tabs (id) ON DELETE CASCADE,
  tx_hash       TEXT,
  block_height  INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'confirmed', 'failed', 'cancelled')),
  batch_id      TEXT,
  created_at    INTEGER NOT NULL,
  confirmed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_transfers_tab ON transfers (tab_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers (from_addr);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers (to_addr);
CREATE INDEX IF NOT EXISTS idx_transfers_batch ON transfers (batch_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers (status);

-- An event log of debt rings Loop has spotted and erased. Purely for the
-- activity feed and the running "debt erased" counter — balances are computed
-- live and never read this table, so a missing row here can never cost anybody
-- money. `ring_key` makes re-spotting the same ring idempotent.
CREATE TABLE IF NOT EXISTS loop_runs (
  id           TEXT PRIMARY KEY,
  ring_key     TEXT NOT NULL UNIQUE,
  amount_luna  INTEGER NOT NULL,
  members      TEXT NOT NULL,          -- JSON array of addresses, in ring order
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loop_runs_created ON loop_runs (created_at DESC);

-- Cached NIM price so we are not hammering a public API from every request.
CREATE TABLE IF NOT EXISTS price_cache (
  currency    TEXT PRIMARY KEY,
  rate        REAL NOT NULL,
  fetched_at  INTEGER NOT NULL
);
