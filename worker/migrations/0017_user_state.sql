-- 0017: Per-user synced state (key/value). Holds player preferences, watch/read positions and
-- "continue" lists so they follow the user across devices. Last write wins per key.
CREATE TABLE IF NOT EXISTS user_state (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, key)
);
