import { Hono } from "hono";
import { requireAdmin, requireAuth, viewerId } from "./auth";
import { bool, field, int, num, readJson, str, type AppEnv, type Ctx } from "./util";

// Manga section (catalog + per-user reading data + readlist). Mirrors the anime routes, but with a
// plain JSON shape (camelCase) and kebab-case paths under /api/manga and /api/readlist.
// Catalog fields are shared and only admins may change existing entries; score, status, progress,
// Plan to Read, notes and dates always go to the caller's own user_manga row.

export const READ_STATUSES = ["READING", "COMPLETED", "PAUSED", "DROPPED", "PLANNING"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type MangaRow = {
  id: number;
  name: string;
  english_name: string | null;
  status: string;
  format: string;
  total_chapters: number;
  total_volumes: number;
  mal_score: number | null;
  genres: string;
  cover: string | null;
  anilist_id: number | null;
  mal_id: number | null;
  mal_link: string | null;
  anilist_link: string | null;
  synced_at: string | null;
  mangadex_id?: string | null;
  series_name?: string | null;
  score: number | null;
  read_status: string | null;
  chapters_read: number | null;
  volumes_read: number | null;
  plan_to_read: number | null;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  in_list: number | null;
};

export const MANGA_COLUMNS = `m.id, m.name, m.english_name, m.status, m.format, m.total_chapters, m.total_volumes, m.mal_score,
  m.genres, m.cover, m.anilist_id, m.mal_id, m.mal_link, m.anilist_link, m.synced_at, m.mangadex_id, m.series_name,
  u.score, u.read_status, u.chapters_read, u.volumes_read, u.plan_to_read, u.notes, u.started_at, u.finished_at,
  u.user_id IS NOT NULL AS in_list`;
export const MANGA_FROM = `manga m LEFT JOIN user_manga u ON u.manga_id = m.id AND u.user_id = ?`;

export const toManga = (r: MangaRow) => ({
  id: r.id,
  name: r.name,
  englishName: r.english_name ?? "",
  status: r.status ?? "",
  format: r.format ?? "",
  totalChapters: r.total_chapters ?? 0,
  totalVolumes: r.total_volumes ?? 0,
  malScore: r.mal_score ?? 0,
  genres: r.genres ? r.genres.split(", ").filter(Boolean) : [],
  cover: r.cover ?? "",
  anilistId: r.anilist_id ?? 0,
  malId: r.mal_id ?? 0,
  malLink: r.mal_link ?? "",
  anilistLink: r.anilist_link ?? "",
  syncedAt: r.synced_at ?? "",
  mangadexId: r.mangadex_id ?? "",
  seriesName: r.series_name ?? "",
  score: r.score ?? 0,
  readStatus: r.read_status ?? "",
  chaptersRead: r.chapters_read ?? 0,
  volumesRead: r.volumes_read ?? 0,
  planToRead: Boolean(r.plan_to_read),
  notes: r.notes ?? "",
  startedAt: r.started_at ?? "",
  finishedAt: r.finished_at ?? "",
  inMyList: Boolean(r.in_list),
});

const SORTS: Record<string, string> = {
  name: "LOWER(m.name)",
  score: "COALESCE(u.score, 0)",
  "mal-score": "COALESCE(m.mal_score, 0)",
  chapters: "m.total_chapters",
  progress: "COALESCE(u.chapters_read, 0)",
  status: "m.status",
  "read-status": "u.read_status",
  updated: "u.updated_at",
  added: "m.id",
};

const placeholders = (n: number) => Array(n).fill("?").join(", ");

function catalogFields(body: Record<string, unknown>) {
  const malScore = num(field(body, "malScore"));
  return {
    name: str(field(body, "name")).trim(),
    english_name: str(field(body, "englishName")).trim(),
    status: str(field(body, "status")),
    format: str(field(body, "format")),
    total_chapters: Math.max(0, int(field(body, "totalChapters"))),
    total_volumes: Math.max(0, int(field(body, "totalVolumes"))),
    mal_score: malScore >= 0 && malScore <= 10 ? malScore : 0,
    genres: (Array.isArray(field(body, "genres")) ? (field(body, "genres") as unknown[]).map(str) : str(field(body, "genres")).split(","))
      .map((g) => g.trim())
      .filter(Boolean)
      .join(", "),
    cover: str(field(body, "cover")),
    anilist_id: int(field(body, "anilistId")) || null,
    mal_id: int(field(body, "malId")) || null,
    mal_link: str(field(body, "malLink")),
    anilist_link: str(field(body, "anilistLink")),
    series_name: str(field(body, "seriesName")).trim(),
  };
}

type UserMangaFields = Partial<{
  score: number;
  read_status: string;
  chapters_read: number;
  volumes_read: number;
  plan_to_read: number;
  notes: string;
  started_at: string | null;
  finished_at: string | null;
}>;

/** Reads only the user fields present in the body; returns an error string on invalid input. */
function userFields(body: Record<string, unknown>): UserMangaFields | string {
  const out: UserMangaFields = {};
  const has = (k: string) => field(body, k) !== undefined;
  if (has("score")) {
    const s = num(field(body, "score"));
    if (s < 0 || s > 10) return "Puan 0-10 arasında olmalı";
    out.score = s;
  }
  if (has("readStatus")) {
    const rs = str(field(body, "readStatus")).toUpperCase();
    if (rs && !(READ_STATUSES as readonly string[]).includes(rs)) return "Geçersiz okuma durumu";
    out.read_status = rs;
  }
  if (has("chaptersRead")) out.chapters_read = Math.max(0, int(field(body, "chaptersRead")));
  if (has("volumesRead")) out.volumes_read = Math.max(0, int(field(body, "volumesRead")));
  if (has("planToRead")) out.plan_to_read = bool(field(body, "planToRead")) ? 1 : 0;
  if (has("notes")) out.notes = str(field(body, "notes"));
  for (const [key, col] of [["startedAt", "started_at"], ["finishedAt", "finished_at"]] as const) {
    if (!has(key)) continue;
    const v = str(field(body, key)).trim();
    if (v && !DATE_RE.test(v)) return "Tarih YYYY-AA-GG olmalı";
    out[col] = v || null;
  }
  if (out.started_at && out.finished_at && out.finished_at < out.started_at) return "Bitiş tarihi başlamadan önce olamaz";
  return out;
}

/** Inserts or updates the caller's row; only the given columns are written (triggers keep the readlist in sync). */
export function upsertUserManga(db: D1Database, userId: number, mangaId: number, f: UserMangaFields) {
  const cols = Object.keys(f);
  const update = cols.length
    ? `DO UPDATE SET ${cols.map((k) => `${k} = excluded.${k}`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    : "DO NOTHING";
  return db
    .prepare(
      `INSERT INTO user_manga (user_id, manga_id${cols.map((k) => `, ${k}`).join("")})
       VALUES (?, ?${cols.map(() => ", ?").join("")})
       ON CONFLICT (user_id, manga_id) ${update}`
    )
    .bind(userId, mangaId, ...Object.values(f));
}

export async function mangaById(c: Ctx, id: number) {
  const row = await c.env.DB.prepare(`SELECT ${MANGA_COLUMNS} FROM ${MANGA_FROM} WHERE m.id = ?`)
    .bind(await viewerId(c), id)
    .first<MangaRow>();
  return row ? toManga(row) : null;
}

export const manga = new Hono<AppEnv>();

// List with filters: q, status, read-status (NONE = not in list), genre (repeatable), format,
// ptr=1, mine=1, sort, order, page, count
manga.get("/manga", requireAuth, async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.q?.trim()) {
    where.push("(m.name LIKE ? OR m.english_name LIKE ?)");
    params.push(`%${q.q.trim()}%`, `%${q.q.trim()}%`);
  }
  if (q.status) {
    where.push("m.status = ?");
    params.push(q.status);
  }
  if (q.format) {
    where.push("m.format = ?");
    params.push(q.format);
  }
  if (q["read-status"] === "NONE") where.push("COALESCE(u.read_status, '') = ''");
  else if (q["read-status"]) {
    where.push("u.read_status = ?");
    params.push(q["read-status"]);
  }
  const genres = c.req.queries("genre")?.filter(Boolean) ?? [];
  for (const g of genres) {
    where.push("(', ' || m.genres || ', ') LIKE ?");
    params.push(`%, ${g}, %`);
  }
  if (q.ptr === "1") where.push("COALESCE(u.plan_to_read, 0) = 1");
  if (q.mine === "1") where.push("u.user_id IS NOT NULL");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const count = Math.min(Math.max(int(q.count) || 48, 1), 500);
  const page = Math.max(int(q.page) || 1, 1);
  const orderBy = SORTS[q.sort ?? ""] ?? SORTS.name;
  const order = q.order === "desc" ? "DESC" : "ASC";
  const viewer = await viewerId(c);
  const db = c.env.DB;
  const [list, total] = await db.batch([
    db
      .prepare(`SELECT ${MANGA_COLUMNS} FROM ${MANGA_FROM} ${whereSql} ORDER BY ${orderBy} ${order}, m.id ASC LIMIT ? OFFSET ?`)
      .bind(viewer, ...params, count, (page - 1) * count),
    db.prepare(`SELECT COUNT(*) AS n FROM ${MANGA_FROM} ${whereSql}`).bind(viewer, ...params),
  ]);
  const totalCount = Number((total.results?.[0] as { n: number } | undefined)?.n ?? 0);
  return c.json({
    data: (list.results as MangaRow[]).map(toManga),
    pagination: { page, count, total: totalCount, pages: Math.ceil(totalCount / count) },
  });
});

manga.get("/manga/genres", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT genres FROM manga WHERE genres <> ''").all<{ genres: string }>();
  const set = new Set<string>();
  for (const r of results) for (const g of r.genres.split(", ")) if (g) set.add(g);
  return c.json([...set].sort());
});

manga.get("/manga/:id{[0-9]+}", requireAuth, async (c) => {
  const m = await mangaById(c, int(c.req.param("id")));
  return m ? c.json(m) : c.json({ message: "Manga bulunamadı" }, 404);
});

// Adds a manga (or reuses the catalog entry with the same AniList id / name) and writes the caller's data
manga.post("/manga", requireAuth, async (c) => {
  const body = await readJson(c);
  const f = catalogFields(body);
  if (!f.name) return c.json({ message: "Manga adı boş olamaz" }, 400);
  const uf = userFields(body);
  if (typeof uf === "string") return c.json({ message: uf }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;

  const existing =
    (f.anilist_id && (await db.prepare("SELECT id FROM manga WHERE anilist_id = ?").bind(f.anilist_id).first<{ id: number }>())) ||
    (await db.prepare("SELECT id FROM manga WHERE name = ? COLLATE NOCASE").bind(f.name).first<{ id: number }>());
  let id: number;
  if (existing) {
    id = existing.id;
    if (user.isAdmin) {
      const entries = Object.entries(f).filter(([k, v]) => k !== "name" && v !== "" && v !== 0 && v !== null);
      if (entries.length) {
        await db
          .prepare(`UPDATE manga SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
          .bind(...entries.map(([, v]) => v), id)
          .run();
      }
    }
  } else {
    const cols = Object.keys(f);
    const res = await db
      .prepare(`INSERT INTO manga (${cols.join(", ")}) VALUES (${placeholders(cols.length)})`)
      .bind(...Object.values(f))
      .run();
    id = Number(res.meta.last_row_id);
  }
  await upsertUserManga(db, user.userId, id, uf).run();
  return c.json(await mangaById(c, id), existing ? 200 : 201);
});

// Admins may change catalog fields too; everyone else only their own reading data
manga.put("/manga/:id{[0-9]+}", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  const body = await readJson(c);
  const db = c.env.DB;
  const user = c.get("user")!;
  if (!(await db.prepare("SELECT id FROM manga WHERE id = ?").bind(id).first())) return c.json({ message: "Manga bulunamadı" }, 404);
  const uf = userFields(body);
  if (typeof uf === "string") return c.json({ message: uf }, 400);

  if (user.isAdmin && field(body, "name") !== undefined) {
    const f = catalogFields(body);
    if (!f.name) return c.json({ message: "Manga adı boş olamaz" }, 400);
    const cols = Object.keys(f);
    await db
      .prepare(`UPDATE manga SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...Object.values(f), id)
      .run();
  }
  await upsertUserManga(db, user.userId, id, uf).run();
  return c.json(await mangaById(c, id));
});

// Removes the manga from the caller's list (catalog entry stays)
manga.delete("/manga/:id{[0-9]+}/mine", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM user_manga WHERE user_id = ? AND manga_id = ?").bind(c.get("user")!.userId, id).run();
  await c.env.DB.prepare("DELETE FROM readlist WHERE user_id = ? AND manga_id = ?").bind(c.get("user")!.userId, id).run();
  return c.json({ message: "OK" });
});

manga.delete("/manga/:id{[0-9]+}", requireAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM manga WHERE id = ?").bind(int(c.req.param("id"))).run();
  return c.json({ message: "OK" });
});

// AniList sync: the browser queries AniList (it blocks Workers) and posts the results here.
// Body: { items: [{ id, anilistId, malId, name, englishName, status, format, totalChapters, totalVolumes, malScore, genres, cover, anilistLink, malLink }] }
manga.post("/manga/sync-batch", requireAdmin, async (c) => {
  const body = await readJson(c);
  const items = Array.isArray(field(body, "items")) ? (field(body, "items") as Record<string, unknown>[]) : [];
  if (!items.length) return c.json({ message: "items boş", updated: 0 }, 400);
  const db = c.env.DB;
  const stmts = items.slice(0, 100).flatMap((it) => {
    const id = int(field(it, "id"), -1);
    if (id < 0) return [];
    const f = catalogFields(it);
    return [
      db
        .prepare(
          `UPDATE manga SET
             english_name = CASE WHEN ? = '' THEN english_name ELSE ? END,
             status = CASE WHEN ? = '' THEN status ELSE ? END,
             format = CASE WHEN ? = '' THEN format ELSE ? END,
             total_chapters = CASE WHEN ? > 0 THEN ? ELSE total_chapters END,
             total_volumes = CASE WHEN ? > 0 THEN ? ELSE total_volumes END,
             mal_score = CASE WHEN ? > 0 THEN ? ELSE mal_score END,
             genres = CASE WHEN ? = '' THEN genres ELSE ? END,
             cover = CASE WHEN ? = '' THEN cover ELSE ? END,
             anilist_id = COALESCE(?, anilist_id),
             mal_id = COALESCE(?, mal_id),
             anilist_link = CASE WHEN ? = '' THEN anilist_link ELSE ? END,
             mal_link = CASE WHEN ? = '' THEN mal_link ELSE ? END,
             series_name = CASE WHEN ? = '' THEN series_name ELSE ? END,
             synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`
        )
        .bind(
          f.english_name, f.english_name, f.status, f.status, f.format, f.format,
          f.total_chapters, f.total_chapters, f.total_volumes, f.total_volumes, f.mal_score, f.mal_score,
          f.genres, f.genres, f.cover, f.cover, f.anilist_id, f.mal_id,
          f.anilist_link, f.anilist_link, f.mal_link, f.mal_link, f.series_name, f.series_name, id
        ),
    ];
  });
  if (!stmts.length) return c.json({ message: "Geçerli kayıt yok", updated: 0 }, 400);
  // anilist_id is UNIQUE: a duplicate would fail the whole batch, so report it instead of a 500
  try {
    const res = await db.batch(stmts);
    return c.json({ message: "OK", updated: res.reduce((n, r) => n + (r.meta.changes ?? 0), 0) });
  } catch (e) {
    return c.json({ message: `Sync yazılamadı: ${(e as Error).message}` }, 409);
  }
});

// ---- Readlist (Plan to Read queue) ----

const SELECT_READLIST = `SELECT r.id AS r_id, r.order_rank AS r_order_rank, ${MANGA_COLUMNS}
  FROM readlist r JOIN manga m ON m.id = r.manga_id
  LEFT JOIN user_manga u ON u.manga_id = m.id AND u.user_id = r.user_id`;
const NEXT_RANK = "(SELECT COALESCE(MAX(order_rank), 0) + 1 FROM readlist WHERE user_id = ?)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toReadItem = (r: any) => ({ id: r.r_id, orderRank: r.r_order_rank, manga: toManga(r) });

manga.get("/readlist", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT_READLIST} WHERE r.user_id = ? ORDER BY r.order_rank ASC, r.id ASC`)
    .bind(await viewerId(c))
    .all();
  return c.json(results.map(toReadItem));
});

manga.post("/readlist", requireAuth, async (c) => {
  const mangaId = int(field(await readJson(c), "mangaId"), -1);
  const userId = c.get("user")!.userId;
  const db = c.env.DB;
  if (!(await db.prepare("SELECT id FROM manga WHERE id = ?").bind(mangaId).first())) return c.json({ message: "Manga bulunamadı" }, 404);
  await db.batch([
    upsertUserManga(db, userId, mangaId, { plan_to_read: 1 }),
    db.prepare(`INSERT OR IGNORE INTO readlist (user_id, manga_id, order_rank) VALUES (?, ?, ${NEXT_RANK})`).bind(userId, mangaId, userId),
  ]);
  return c.json({ message: "OK" });
});

manga.put("/readlist/order", requireAuth, async (c) => {
  const body = await readJson(c).catch(() => ({}));
  const raw = Array.isArray(body) ? body : (field(body, "items") as unknown[]) ?? [];
  const updates = (raw as Record<string, unknown>[])
    .map((it) => ({ id: int(field(it, "id"), -1), rank: int(field(it, "orderRank")) }))
    .filter((u) => u.id >= 0);
  if (!updates.length) return c.json({ message: "Geçersiz istek" }, 400);
  const userId = c.get("user")!.userId;
  const db = c.env.DB;
  await db.batch(
    updates.map((u) =>
      db
        .prepare("UPDATE readlist SET order_rank = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?")
        .bind(u.rank, u.id, userId)
    )
  );
  return c.json({ message: "OK", updated: updates.length });
});

manga.delete("/readlist/:id{[0-9]+}", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  const userId = c.get("user")!.userId;
  const db = c.env.DB;
  const entry = await db.prepare("SELECT manga_id FROM readlist WHERE id = ? AND user_id = ?").bind(id, userId).first<{ manga_id: number }>();
  if (!entry) return c.json({ message: "Kayıt bulunamadı" }, 404);
  await db.batch([
    db.prepare("DELETE FROM readlist WHERE id = ?").bind(id),
    db.prepare("UPDATE user_manga SET plan_to_read = 0 WHERE user_id = ? AND manga_id = ?").bind(userId, entry.manga_id),
  ]);
  return c.json({ message: "OK", id, mangaId: entry.manga_id });
});

// Reader progress: called when a chapter is finished. Never lowers chapters_read; sets the status to
// READING (or COMPLETED on the last chapter) unless the user picked one already.
manga.put("/manga/:id{[0-9]+}/progress", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  const chapter = Math.floor(num(field(await readJson(c), "chaptersRead")));
  if (chapter < 1) return c.json({ message: "Geçersiz bölüm" }, 400);
  const db = c.env.DB;
  const m = await db.prepare("SELECT total_chapters FROM manga WHERE id = ?").bind(id).first<{ total_chapters: number }>();
  if (!m) return c.json({ message: "Manga bulunamadı" }, 404);
  const userId = c.get("user")!.userId;
  const done = m.total_chapters > 0 && chapter >= m.total_chapters;
  await db
    .prepare(
      `INSERT INTO user_manga (user_id, manga_id, chapters_read, read_status) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, manga_id) DO UPDATE SET
         chapters_read = MAX(chapters_read, excluded.chapters_read),
         read_status = CASE
           WHEN ? AND read_status IN ('', 'READING', 'PLANNING', 'PAUSED') THEN 'COMPLETED'
           WHEN read_status IN ('', 'PLANNING') THEN 'READING'
           ELSE read_status END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .bind(userId, id, chapter, done ? "COMPLETED" : "READING", done ? 1 : 0)
    .run();
  return c.json(await mangaById(c, id));
});
