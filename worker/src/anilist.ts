import { Hono } from "hono";
import { requireAdmin } from "./auth";
import { bool, field, int, readJson, type AppEnv } from "./util";

// AniList sync'i. AniList, Cloudflare Workers'ın çıkış IP'lerini engellediği için arama
// tarayıcıda yapılır (frontend/src/Services/anilist.ts); bu uç yalnızca gelen sonuçlardan
// en iyi eşleşmeyi seçip eksik alanları DB'ye yazar.

export const anilistRoutes = new Hono<AppEnv>();

// --- Sync ---

type Media = {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null };
  episodes: number | null;
  status: string | null;
  format: string | null;
  averageScore: number | null;
  genres: string[];
  coverImage: { large: string | null; extraLarge?: string | null } | null;
  relations: { edges: { relationType: string; node: { type: string; title: { romaji: string | null; english: string | null } } }[] } | null;
};

type SyncRow = {
  id: number;
  name: string;
  english_name: string | null;
  anime_status: string | null;
  total_number_of_episodes: number | null;
  mal_score: number | null;
  mal_anime_link: string | null;
  cover: string | null;
  series: number | null;
  genre_count: number;
};

// İstemciden gelen veri: yalnızca beklenen biçimdeki kayıtlar kullanılır
function isMedia(v: unknown): v is Media {
  const m = v as Media;
  return (
    !!m &&
    typeof m === "object" &&
    typeof m.title === "object" &&
    m.title !== null &&
    Array.isArray(m.genres) &&
    m.genres.every((g) => typeof g === "string") &&
    (m.idMal == null || Number.isInteger(m.idMal)) &&
    (m.episodes == null || Number.isInteger(m.episodes)) &&
    (m.averageScore == null || typeof m.averageScore === "number") &&
    (m.coverImage?.large == null || /^https:\/\//.test(m.coverImage.large)) &&
    (m.coverImage?.extraLarge == null || /^https:\/\//.test(m.coverImage.extraLarge))
  );
}

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

function bestMatch(name: string, list: Media[]): Media | undefined {
  const target = lower(name);
  return (
    list.find((m) => lower(m.title.romaji) === target || lower(m.title.english) === target) ??
    list.find((m) => lower(m.title.romaji).includes(target) || lower(m.title.english).includes(target)) ??
    list[0]
  );
}

/**
 * Sezon ekini atıp serinin ortak adını bırakır: "Seihantai na Kimi to Boku 2nd Season" → "Seihantai na Kimi to Boku",
 * "Kimetsu no Yaiba: Yuukaku-hen" → "Kimetsu no Yaiba", "Mob Psycho 100 III" → "Mob Psycho 100".
 */
export function seriesBaseTitle(title: string): string {
  // Yalnızca ": " ile ayrılan alt başlık atılır ("Re:Zero" gibi adlar bozulmasın)
  let t = title.split(/:\s/)[0].trim();
  const SUFFIX =
    /\s+(?:\(?\d+(?:st|nd|rd|th)\s+(?:season|cour)\)?|season\s*\d+|(?:part|cour)\s*\d+|(?:the\s+)?final\s+season|2nd|3rd|\d+th|ii|iii|iv|v|vi|\d)$/i;
  for (let i = 0; i < 3 && SUFFIX.test(t); i++) t = t.replace(SUFFIX, "").trim();
  return t;
}

/**
 * Animenin serisi. Önce ana hikaye (spin-off'lar için), sonra önceki sezon; ilk sezon devamı varsa kendi
 * adıyla seriyi başlatır. Her sezon sezon eki atılmış ortak adı kullandığı için 1. ve 2. sezon aynı
 * seride buluşur (eskiden 1. sezon devamının tam adını, 2. sezon 1. sezonun adını alıp ayrılıyordu).
 */
function seriesNameFor(m: Media): string {
  const edges = (m.relations?.edges ?? []).filter((e) => e.node.type === "ANIME");
  const title = (t: { romaji: string | null; english: string | null }) => (t.romaji ?? t.english ?? "").trim();
  const find = (type: string) => edges.find((e) => e.relationType === type);
  const parent = find("PARENT");
  if (parent) return seriesBaseTitle(title(parent.node.title));
  const prequel = find("PREQUEL");
  if (prequel) return seriesBaseTitle(title(prequel.node.title));
  if (find("SEQUEL")) return seriesBaseTitle(title(m.title));
  const alt = find("ALTERNATIVE");
  if (alt) return seriesBaseTitle(title(alt.node.title));
  return "";
}

export const SYNC_BATCH = 8;

const PENDING_WHERE = "a.series = 0 OR a.series IS NULL";

// Sync'e girecek animelerin listesi (Go'daki gibi serisi atanmamış olanlar)
anilistRoutes.get("/sync/pending", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT a.id, a.name FROM animes a WHERE ${PENDING_WHERE} ORDER BY a.id`).all<{
    id: number;
    name: string;
  }>();
  return c.json({ items: results, batchSize: SYNC_BATCH });
});

export const statusLabel = (s: string | null | undefined) =>
  s === "FINISHED" ? "Finished" : s === "NOT_YET_RELEASED" ? "Not yet aired" : s ? "Currently Airing" : "";

// Gövde: { items: [{ id, media: [AniList Media, ...] }], force? } (tarayıcının AniList'ten aldığı arama sonuçları).
// force (#20, tek anime sync): yalnızca boş alanları değil durum, bölüm, MAL puanı, kapak, türler ve seriyi de
// AniList'teki değerle yeniler. Kullanıcıların puan, bölüm ve notlarına dokunulmaz (user_anime).
anilistRoutes.post("/sync/batch", requireAdmin, async (c) => {
  const body = await readJson(c);
  const force = bool(field(body, "force"));
  const raw = field(body, "items");
  const media = new Map<number, Media[]>();
  for (const it of (Array.isArray(raw) ? raw : []).slice(0, SYNC_BATCH) as Record<string, unknown>[]) {
    const id = int(it?.id, -1);
    if (id >= 0) media.set(id, (Array.isArray(it.media) ? it.media : []).filter(isMedia));
  }
  if (!media.size) return c.json({ updated: 0, failed: 0, errors: [], messages: [] });
  const ids = [...media.keys()];
  const db = c.env.DB;

  const { results: rows } = await db
    .prepare(
      `SELECT a.id, a.name, a.english_name, a.anime_status, a.total_number_of_episodes, a.mal_score, a.mal_anime_link,
         CASE WHEN a.cover IS NULL OR a.cover = '' THEN '' ELSE 'x' END AS cover, a.series,
         (SELECT COUNT(*) FROM animes_genres ag WHERE ag.anime_id = a.id) AS genre_count
       FROM animes a WHERE a.id IN (${ids.map(() => "?").join(", ")})`
    )
    .bind(...ids)
    .all<SyncRow>();

  const genres = new Map(
    (await db.prepare("SELECT id, genre_name FROM genres").all<{ id: number; genre_name: string }>()).results.map((g) => [
      lower(g.genre_name),
      g.id,
    ])
  );

  let updated = 0;
  let failed = 0;
  const errors: string[] = [];
  const messages: string[] = [];

  for (const anime of rows) {
    const m = bestMatch(anime.name, media.get(anime.id) ?? []);
    if (!m) {
      failed++;
      errors.push(`Anime bulunamadı: ${anime.name}`);
      continue;
    }
    const sets: Record<string, unknown> = { is_movie: m.format === "MOVIE" ? 1 : 0 };
    if (Number.isInteger(m.id)) sets.anilist_id = m.id;
    if ((force || !anime.english_name) && m.title.english) sets.english_name = m.title.english;
    if ((force || !anime.mal_anime_link) && m.idMal) sets.mal_anime_link = `https://myanimelist.net/anime/${m.idMal}`;
    if ((force || !(anime.mal_score! > 0)) && m.averageScore) sets.mal_score = m.averageScore / 10;
    if ((force || !(anime.total_number_of_episodes! > 0)) && m.episodes) sets.total_number_of_episodes = m.episodes;
    if ((force || !anime.anime_status) && m.status) sets.anime_status = statusLabel(m.status);
    const cover = m.coverImage?.extraLarge ?? m.coverImage?.large;
    if ((force || !anime.cover) && cover) sets.cover = cover;

    const stmts: D1PreparedStatement[] = [];
    const seriesName = seriesNameFor(m);
    if (seriesName) {
      stmts.push(db.prepare("INSERT OR IGNORE INTO anime_series (name) VALUES (?)").bind(seriesName));
    }
    const cols = Object.keys(sets);
    stmts.push(
      db
        .prepare(
          `UPDATE animes SET ${cols.map((k) => `${k} = ?`).join(", ")}${seriesName ? ", series = (SELECT id FROM anime_series WHERE name = ?)" : ""} WHERE id = ?`
        )
        .bind(...Object.values(sets), ...(seriesName ? [seriesName] : []), anime.id)
    );

    if (m.genres.length && (force || anime.genre_count < m.genres.length)) {
      for (const g of m.genres) {
        if (!genres.has(lower(g))) {
          const created = await db.prepare("INSERT INTO genres (genre_name) VALUES (?) RETURNING id").bind(g).first<{ id: number }>();
          if (created) genres.set(lower(g), created.id);
        }
      }
      stmts.push(db.prepare("DELETE FROM animes_genres WHERE anime_id = ?").bind(anime.id));
      for (const g of m.genres) {
        const gid = genres.get(lower(g));
        if (gid) stmts.push(db.prepare("INSERT OR IGNORE INTO animes_genres (anime_id, genre_id) VALUES (?, ?)").bind(anime.id, gid));
      }
    }

    try {
      await db.batch(stmts);
      updated++;
      messages.push(`${anime.name} → ${m.title.romaji ?? m.title.english}${seriesName ? ` (seri: ${seriesName})` : ""}`);
    } catch (err) {
      failed++;
      errors.push(`${anime.name}: ${(err as Error).message}`);
    }
  }

  return c.json({ updated, failed, errors, messages });
});
