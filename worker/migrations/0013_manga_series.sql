-- 0013: Manganın serisi (AniList ilişkilerinden; ör. ana hikaye ve devam/önceki ciltler aynı seride)
ALTER TABLE manga ADD COLUMN series_name TEXT NOT NULL DEFAULT '';
