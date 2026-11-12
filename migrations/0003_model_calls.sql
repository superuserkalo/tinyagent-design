-- TinyAgent Design: model calls that outlive the tab that started them.
-- The server runs each model call to the end and saves its output as it streams, so a
-- reloaded tab (or another device) picks the call up where it is instead of starting it
-- again. The model's thinking is kept here too; it is never sent to the browser.
-- Times are milliseconds since the Unix epoch.

-- One row per model call. The id is a hash of the user, the chat and the exact request,
-- so the SDK repeating an interrupted step finds the call it already started.
-- `attempt` fences a call that was started again after its first run died.
CREATE TABLE IF NOT EXISTS model_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,            -- running, done, failed, cancelled, archived
  attempt INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  reasoning TEXT NOT NULL DEFAULT '',
  frames INTEGER NOT NULL DEFAULT 0,
  usage TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS model_calls_chat ON model_calls (chat_id, status);
CREATE INDEX IF NOT EXISTS model_calls_status_updated ON model_calls (status, updated_at);

-- The streamed output, a few hundred milliseconds per frame, kept for an hour after the
-- call ends (long enough for any reload to replay it), then deleted.
CREATE TABLE IF NOT EXISTS model_frames (
  call_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (call_id, seq)
);
