import { Hono } from "hono";
import { requireAuth, viewerId } from "./auth";
import { LIST_COLUMNS, toAnime, upsertUserAnime } from "./anime";
import { field, int, readJson, type AppEnv, type Ctx } from "./util";

// Her kullanıcının kendi watchlist'i var. Liste, user_anime.plan_to_watch ile D1 trigger'larıyla
// senkron tutulur (0002_user_data.sql): işaret açılınca listeye eklenir, kapanınca çıkarılır.

const SELECT_ITEMS = `SELECT w.id AS w_id, w.anime_id AS w_anime_id, w.order_rank AS w_order_rank,
    w.created_at AS w_created_at, w.updated_at AS w_updated_at, ${LIST_COLUMNS}
  FROM watch_lists w
  JOIN animes a ON a.id = w.anime_id
  LEFT JOIN anime_series s ON s.id = a.series
  LEFT JOIN user_anime u ON u.anime_id = a.id AND u.user_id = w.user_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toItem = (c: Ctx, r: any) => ({
  id: r.w_id,
  anime_id: r.w_anime_id,
  order_rank: r.w_order_rank,
  anime: toAnime(c, r),
  created_at: r.w_created_at,
  updated_at: r.w_updated_at,
});

async function itemById(c: Ctx, userId: number, id: number) {
  const row = await c.env.DB.prepare(`${SELECT_ITEMS} WHERE w.id = ? AND w.user_id = ?`).bind(id, userId).first();
  return row ? toItem(c, row) : null;
}

const NEXT_RANK = "(SELECT COALESCE(MAX(order_rank), 0) + 1 FROM watch_lists WHERE user_id = ?)";

export const watchlist = new Hono<AppEnv>();

watchlist.get("/watchlist", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT_ITEMS} WHERE w.user_id = ? ORDER BY w.order_rank ASC, w.id ASC`)
    .bind(await viewerId(c))
    .all();
  return c.json(results.map((r) => toItem(c, r)));
});

watchlist.post("/watchlist", requireAuth, async (c) => {
  const animeId = int(field(await readJson(c), "anime_id"), -1);
  const userId = c.get("user")!.userId;
  const db = c.env.DB;
  const anime = await db.prepare("SELECT id FROM animes WHERE id = ?").bind(animeId).first();
  if (!anime) return c.json({ error: "Anime not found" }, 404);

  const existing = await db
    .prepare("SELECT id FROM watch_lists WHERE user_id = ? AND anime_id = ?")
    .bind(userId, animeId)
    .first<{ id: number }>();
  if (existing) {
    return c.json({ message: "Anime already exists in watch list", data: await itemById(c, userId, existing.id) });
  }
  // plan_to_watch=1 trigger ile listenin sonuna ekler; işaret zaten açıksa doğrudan eklenir
  await db.batch([
    upsertUserAnime(db, userId, animeId, { plan_to_watch: 1 }),
    db
      .prepare(`INSERT OR IGNORE INTO watch_lists (user_id, anime_id, order_rank) VALUES (?, ?, ${NEXT_RANK})`)
      .bind(userId, animeId, userId),
  ]);
  const row = await db
    .prepare("SELECT id FROM watch_lists WHERE user_id = ? AND anime_id = ?")
    .bind(userId, animeId)
    .first<{ id: number }>();
  return c.json({ message: "Anime added to watch list successfully", data: row ? await itemById(c, userId, row.id) : null });
});

// Tek kayıt ({id, order_rank}) ya da toplu sıralama ([{id, order_rank}, ...]) kabul eder
watchlist.put("/watchlist/order", requireAuth, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const items = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
  const updates = items
    .map((it) => ({ id: int(field(it, "id"), -1), rank: int(field(it, "order_rank")) }))
    .filter((it) => it.id >= 0);
  if (!updates.length) return c.json({ error: "Invalid request body" }, 400);

  const userId = c.get("user")!.userId;
  const db = c.env.DB;
  const results = await db.batch(
    updates.map((u) =>
      db
        .prepare("UPDATE watch_lists SET order_rank = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?")
        .bind(u.rank, u.id, userId)
    )
  );
  if (!Array.isArray(body)) {
    if (!results[0].meta.changes) return c.json({ error: "Watch list entry not found" }, 404);
    return c.json({ message: "Watch list order updated successfully", data: await itemById(c, userId, updates[0].id) });
  }
  return c.json({ message: "Watch list order updated successfully", updated: updates.length });
});

watchlist.delete("/watchlist", requireAuth, async (c) => {
  const id = int(c.req.query("id"), -1);
  const userId = c.get("user")!.userId;
  const db = c.env.DB;
  const entry = await db
    .prepare("SELECT anime_id FROM watch_lists WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ anime_id: number }>();
  if (!entry) return c.json({ error: "Watch list entry not found" }, 404);
  await db.batch([
    db.prepare("DELETE FROM watch_lists WHERE id = ?").bind(id),
    db.prepare("UPDATE user_anime SET plan_to_watch = 0 WHERE user_id = ? AND anime_id = ?").bind(userId, entry.anime_id),
  ]);
  return c.json({ message: "Watch list entry removed successfully", id, anime_id: entry.anime_id });
});

// Trigger'lar listeyi zaten güncel tutuyor; eski istemciler ve elle düzeltme için korunuyor
watchlist.post("/watchlist/sync", requireAuth, async (c) => {
  const userId = c.get("user")!.userId;
  const db = c.env.DB;
  const missing = await db
    .prepare(
      `SELECT anime_id FROM user_anime WHERE user_id = ? AND plan_to_watch = 1
         AND anime_id NOT IN (SELECT anime_id FROM watch_lists WHERE user_id = ?) ORDER BY anime_id`
    )
    .bind(userId, userId)
    .all<{ anime_id: number }>();
  if (missing.results.length) {
    await db.batch(
      missing.results.map((r) =>
        db
          .prepare(`INSERT OR IGNORE INTO watch_lists (user_id, anime_id, order_rank) VALUES (?, ?, ${NEXT_RANK})`)
          .bind(userId, r.anime_id, userId)
      )
    );
  }
  const total = await db.prepare("SELECT COUNT(*) AS n FROM watch_lists WHERE user_id = ?").bind(userId).first<{ n: number }>();
  return c.json({ message: "Auto sync completed successfully", added: missing.results.length, total: total?.n ?? 0 });
});

// ------------------------------ Waitlist ------------------------------
// Henüz yayınlanmamış animeler (user_anime.wait_list). Plan to Watch'tan ayrıdır; yayın takibi yeni bölüm
// bildirimlerini bu listedekilere de gönderir. Sıra: önce yayın tarihi yakın olanlar.

watchlist.get("/waitlist", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM animes a
     LEFT JOIN anime_series s ON s.id = a.series
     JOIN user_anime u ON u.anime_id = a.id AND u.user_id = ?
     WHERE u.wait_list = 1
     ORDER BY COALESCE(a.next_episode_at, a.start_date, '9999') ASC, LOWER(a.name) ASC`
  )
    .bind(await viewerId(c))
    .all();
  return c.json(results.map((r) => toAnime(c, r as Parameters<typeof toAnime>[1])));
});

// Gövde: { id } → animeyi waitlist'e ekler (kullanıcının kaydı yoksa oluşturur)
watchlist.post("/waitlist", requireAuth, async (c) => {
  const id = int(field(await readJson(c), "id"), -1);
  if (id < 0) return c.json({ message: "Geçersiz anime" }, 400);
  if (!(await c.env.DB.prepare("SELECT id FROM animes WHERE id = ?").bind(id).first())) return c.json({ message: "Anime bulunamadı" }, 404);
  await upsertUserAnime(c.env.DB, c.get("user")!.userId, id, { wait_list: 1 }).run();
  return c.json({ message: "OK" });
});

watchlist.delete("/waitlist/:id{[0-9]+}", requireAuth, async (c) => {
  await upsertUserAnime(c.env.DB, c.get("user")!.userId, int(c.req.param("id")), { wait_list: 0 }).run();
  return c.json({ message: "OK" });
});
