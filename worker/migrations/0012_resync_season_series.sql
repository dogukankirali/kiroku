-- 0012: Eski seri adı kuralı, devamı olan ilk sezonu devamının tam adıyla ("X 2nd Season") ayrı bir seriye
-- koyuyordu; 2. sezon ise "X" serisine giriyordu. Adı sezon ekiyle biten serilere bağlı animeler serisiz
-- bırakılır; bir sonraki AniList Sync (yalnızca serisi olmayanları işler) yeni kuralla ortak seriye bağlar.

UPDATE animes SET series = 0
WHERE series IN (
  SELECT id FROM anime_series
  WHERE name LIKE '% Season' OR name LIKE '% Season %' OR name LIKE '%Season _'
     OR name LIKE '% Part _' OR name LIKE '% Cour _'
     OR name LIKE '% II' OR name LIKE '% III' OR name LIKE '% IV'
     OR name LIKE '% 2' OR name LIKE '% 3' OR name LIKE '% 4'
);

-- Artık hiçbir animenin bağlı olmadığı seri kayıtları silinir
DELETE FROM anime_series WHERE id NOT IN (SELECT DISTINCT series FROM animes WHERE series IS NOT NULL);
