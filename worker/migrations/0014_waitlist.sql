-- 0014: Waitlist. Henüz yayınlanmamış animeler kullanıcının ayrı listesinde bekler (Plan to Watch değildir,
-- watchlist'te görünmez); yayın başlayınca ve yeni bölüm çıkınca bildirim bu listeden de tetiklenir.
-- animes.start_date: yayın başlangıç tarihi (AniList/Kitsu; "YYYY-MM-DD", bilinmiyorsa boş).

ALTER TABLE user_anime ADD COLUMN wait_list INTEGER NOT NULL DEFAULT 0;
ALTER TABLE animes ADD COLUMN start_date TEXT;
CREATE INDEX IF NOT EXISTS idx_user_anime_wait ON user_anime (user_id, wait_list);
