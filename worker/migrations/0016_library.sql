-- 0016: Kitaplığım. Per-user shelf of physical books and manga, tracked by series and volume.
-- A series can optionally point at a catalog entry (manga / books); volumes record what is owned or wanted.

CREATE TABLE IF NOT EXISTS library_series (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'manga',   -- manga | book
  title          TEXT NOT NULL,
  manga_id       INTEGER REFERENCES manga (id) ON DELETE SET NULL,
  book_id        INTEGER REFERENCES books (id) ON DELETE SET NULL,
  total_volumes  INTEGER NOT NULL DEFAULT 0,      -- 0 = unknown
  cover          TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_library_series_user ON library_series (user_id, title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS library_volumes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id      INTEGER NOT NULL REFERENCES library_series (id) ON DELETE CASCADE,
  volume_number  INTEGER NOT NULL,
  edition        TEXT NOT NULL DEFAULT '',
  owned          INTEGER NOT NULL DEFAULT 1,      -- 0 + wanted = 1 is the wishlist
  wanted         INTEGER NOT NULL DEFAULT 0,
  isbn           TEXT,                            -- optional (Turkish editions often lack one)
  title          TEXT NOT NULL DEFAULT '',
  publisher      TEXT NOT NULL DEFAULT '',
  language       TEXT NOT NULL DEFAULT '',
  condition      TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',        -- shelf / box
  cover          TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (series_id, volume_number, edition)
);
CREATE INDEX IF NOT EXISTS idx_library_volumes_isbn ON library_volumes (isbn);
