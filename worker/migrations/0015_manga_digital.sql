-- 0015: Manganın nasıl okunduğu ve dijital okumada kalınan bölüm. read_format: 'DIGITAL', 'PHYSICAL' ya da
-- boş (bilinmiyor). Dijital bilgiler eklentinin okuma sitelerinden (ravenscans, mangadex, mgeko, MANGA Plus...)
-- otomatik yazdığı son okunan bölüm, site ve bölüm adresidir.

ALTER TABLE user_manga ADD COLUMN read_format TEXT;
ALTER TABLE user_manga ADD COLUMN digital_chapter REAL;
ALTER TABLE user_manga ADD COLUMN digital_site TEXT;
ALTER TABLE user_manga ADD COLUMN digital_url TEXT;
ALTER TABLE user_manga ADD COLUMN digital_read_at TEXT;
