-- TinyAgent Design: chats follow the radian.sh account across devices.
-- Each chat is a TinyAgent session whose journal lives here, one row per record.
-- Times are milliseconds since the Unix epoch.

-- A chat belongs to one user. The lease says which tab is running it right now.
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  -- The prompt grant of the run in progress, so a resume is not charged again.
  grant_id TEXT,
  grant_expires_at INTEGER,
  -- Which tab may run this chat, until when. Renewed while a run is active.
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS chats_user_updated ON chats (user_id, updated_at DESC);

-- The journal: record `seq` of session `session_id`, as JSON. A record too large for
-- one row is stored in record_chunks under `chunk_id`, and `body` is empty.
CREATE TABLE IF NOT EXISTS records (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  chunk_id TEXT,
  chunks INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

-- Parts of large records. Keyed by a per-write id, so a writer that loses the
-- fencing race can never overwrite the winner's parts; its own are never read.
CREATE TABLE IF NOT EXISTS record_chunks (
  chunk_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (chunk_id, part)
);

CREATE INDEX IF NOT EXISTS record_chunks_session ON record_chunks (session_id);

-- Published pages, keyed by the publish_design call's executionId
-- ("<sessionId>:<journal sequence>"), so a rerun after a reload overwrites.
CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS designs_session_seq ON designs (session_id, seq);
