-- TinyAgent Design: free prompts and prompt grants (Cloudflare D1, SQLite).
-- Times are milliseconds since the Unix epoch.

-- Free prompts left per radian.sh account. A row appears on the account's first prompt.
CREATE TABLE IF NOT EXISTS quota (
  user_id TEXT PRIMARY KEY,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One grant per prompt sent. Every model request of that run spends one of its requests.
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  max_requests INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS grants_user_id ON grants (user_id);

-- Creating a grant spends a prompt, inside the same INSERT statement: the insert only
-- happens while remaining > 0, and this trigger decrements in that statement's
-- transaction. A grant can never exist without its prompt having been spent.
CREATE TRIGGER IF NOT EXISTS grants_spend_prompt AFTER INSERT ON grants
BEGIN
  UPDATE quota SET remaining = remaining - 1, updated_at = NEW.created_at WHERE user_id = NEW.user_id;
END;

-- Fixed-window rate limits (for example /api/prompts per user per minute).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
