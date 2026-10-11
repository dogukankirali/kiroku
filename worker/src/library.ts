import { Hono } from "hono";
import { requireAuth } from "./auth";
import { bool, field, int, readJson, str, type AppEnv, type Ctx } from "./util";

// Kitaplığım (/api/library): the caller's own physical shelf, tracked by series and volume.
// A volume with owned = 0 and wanted = 1 is on the wishlist.

export const library = new Hono<AppEnv>();

const KINDS = ["manga", "book"] as const;
const MAX_VOLUMES_PER_CALL = 500;

type SeriesRow = {
  id: number;
  kind: string;
  title: string;
  manga_id: number | null;
  book_id: number | null;
  total_volumes: number;
  cover: string | null;
  notes: string;
  owned: number | null;
  wanted: number | null;
  max_volume: number | null;
};

type VolumeRow = {
  id: number;
  series_id: number;
  volume_number: number;
  edition: string;
  owned: number;
  wanted: number;
  isbn: string | null;
  title: string;
  publisher: string;
  language: string;
  condition: string;
  location: string;
  cover: string | null;
  notes: string;
};

const toSeries = (r: SeriesRow) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  mangaId: r.manga_id,
  bookId: r.book_id,
  totalVolumes: r.total_volumes,
  cover: r.cover ?? "",
  notes: r.notes ?? "",
  ownedCount: r.owned ?? 0,
  wantedCount: r.wanted ?? 0,
  maxVolume: r.max_volume ?? 0,
});

const toVolume = (r: VolumeRow) => ({
  id: r.id,
  seriesId: r.series_id,
  number: r.volume_number,
  edition: r.edition,
  owned: Boolean(r.owned),
  wanted: Boolean(r.wanted),
  isbn: r.isbn ?? "",
  title: r.title,
  publisher: r.publisher,
  language: r.language,
  condition: r.condition,
  location: r.location,
  cover: r.cover ?? "",
  notes: r.notes,
});

const SERIES_SELECT = `SELECT s.id, s.kind, s.title, s.manga_id, s.book_id, s.total_volumes, s.cover, s.notes,
    (SELECT COUNT(DISTINCT v.volume_number) FROM library_volumes v WHERE v.series_id = s.id AND v.owned = 1) AS owned,
    (SELECT COUNT(DISTINCT v.volume_number) FROM library_volumes v WHERE v.series_id = s.id AND v.owned = 0 AND v.wanted = 1) AS wanted,
    (SELECT MAX(v.volume_number) FROM library_volumes v WHERE v.series_id = s.id) AS max_volume
  FROM library_series s`;

const userId = (c: Ctx) => c.get("user")!.userId;

async function ownSeries(c: Ctx, id: number) {
  return c.env.DB.prepare(`${SERIES_SELECT} WHERE s.id = ? AND s.user_id = ?`).bind(id, userId(c)).first<SeriesRow>();
}

async function volumesOf(c: Ctx, seriesId: number) {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM library_volumes WHERE series_id = ? ORDER BY volume_number, edition"
  )
    .bind(seriesId)
    .all<VolumeRow>();
  return results.map(toVolume);
}

function seriesFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, string | number | null> = {};
  const title = str(field(body, "title")).trim();
  if (!partial || field(body, "title") !== undefined) out.title = title;
  if (!partial || field(body, "kind") !== undefined) {
    const kind = str(field(body, "kind")) || "manga";
    out.kind = (KINDS as readonly string[]).includes(kind) ? kind : "manga";
  }
  if (!partial || field(body, "totalVolumes") !== undefined) out.total_volumes = Math.max(0, int(field(body, "totalVolumes")));
  if (!partial || field(body, "cover") !== undefined) out.cover = str(field(body, "cover")) || null;
  if (!partial || field(body, "notes") !== undefined) out.notes = str(field(body, "notes"));
  if (field(body, "mangaId") !== undefined) out.manga_id = int(field(body, "mangaId")) || null;
  if (field(body, "bookId") !== undefined) out.book_id = int(field(body, "bookId")) || null;
  return out;
}

library.get("/library/series", requireAuth, async (c) => {
  const kind = c.req.query("kind");
  const q = (c.req.query("q") ?? "").trim();
  const where = ["s.user_id = ?"];
  const params: (string | number)[] = [userId(c)];
  if (kind && (KINDS as readonly string[]).includes(kind)) {
    where.push("s.kind = ?");
    params.push(kind);
  }
  if (q) {
    where.push("s.title LIKE ? ESCAPE '\\'");
    params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const { results } = await c.env.DB.prepare(`${SERIES_SELECT} WHERE ${where.join(" AND ")} ORDER BY LOWER(s.title)`)
    .bind(...params)
    .all<SeriesRow>();
  return c.json(results.map(toSeries));
});

library.post("/library/series", requireAuth, async (c) => {
  const f = seriesFields(await readJson(c), false);
  if (!f.title) return c.json({ message: "Seri adı boş olamaz" }, 400);
  const cols = Object.keys(f);
  const res = await c.env.DB.prepare(
    `INSERT INTO library_series (user_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`
  )
    .bind(userId(c), ...Object.values(f))
    .run();
  const id = Number(res.meta.last_row_id);
  return c.json({ ...toSeries((await ownSeries(c, id))!), volumes: [] }, 201 as 200);
});

library.get("/library/series/:id{[0-9]+}", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  const row = await ownSeries(c, id);
  if (!row) return c.json({ message: "Seri bulunamadı" }, 404);
  return c.json({ ...toSeries(row), volumes: await volumesOf(c, id) });
});

library.put("/library/series/:id{[0-9]+}", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  if (!(await ownSeries(c, id))) return c.json({ message: "Seri bulunamadı" }, 404);
  const f = seriesFields(await readJson(c), true);
  if ("title" in f && !f.title) return c.json({ message: "Seri adı boş olamaz" }, 400);
  const cols = Object.keys(f);
  if (cols.length) {
    await c.env.DB.prepare(
      `UPDATE library_series SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`
    )
      .bind(...Object.values(f), id, userId(c))
      .run();
  }
  return c.json({ ...toSeries((await ownSeries(c, id))!), volumes: await volumesOf(c, id) });
});

library.delete("/library/series/:id{[0-9]+}", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM library_series WHERE id = ? AND user_id = ?").bind(int(c.req.param("id")), userId(c)).run();
  return c.json({ message: "OK" });
});

/**
 * Adds volumes to a series. Body: { numbers: [1, 2, 3], owned?: true, wanted?: false, edition?, isbn?, ... }.
 * Existing volumes (same number and edition) are updated, so re-sending a range flips owned/wanted in bulk.
 */
library.post("/library/series/:id{[0-9]+}/volumes", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  if (!(await ownSeries(c, id))) return c.json({ message: "Seri bulunamadı" }, 404);
  const body = await readJson(c);
  const raw = field(body, "numbers");
  const numbers = [...new Set((Array.isArray(raw) ? raw : []).map((n) => int(n, -1)).filter((n) => n >= 0))];
  if (!numbers.length) return c.json({ message: "Cilt numarası yok" }, 400);
  if (numbers.length > MAX_VOLUMES_PER_CALL) return c.json({ message: `En fazla ${MAX_VOLUMES_PER_CALL} cilt eklenebilir` }, 400);

  const wanted = bool(field(body, "wanted"));
  const owned = field(body, "owned") === undefined ? !wanted : bool(field(body, "owned"));
  const edition = str(field(body, "edition")).trim();
  const isbn = str(field(body, "isbn")).replace(/[-\s]/g, "") || null;
  const detail = (k: string) => str(field(body, k)).trim();

  const stmts = numbers.map((n) =>
    c.env.DB.prepare(
      `INSERT INTO library_volumes (series_id, volume_number, edition, owned, wanted, isbn, title, publisher, language, condition, location, cover, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (series_id, volume_number, edition) DO UPDATE SET
         owned = excluded.owned, wanted = excluded.wanted,
         isbn = COALESCE(excluded.isbn, isbn),
         title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END,
         publisher = CASE WHEN excluded.publisher <> '' THEN excluded.publisher ELSE publisher END,
         language = CASE WHEN excluded.language <> '' THEN excluded.language ELSE language END,
         condition = CASE WHEN excluded.condition <> '' THEN excluded.condition ELSE condition END,
         location = CASE WHEN excluded.location <> '' THEN excluded.location ELSE location END,
         cover = COALESCE(excluded.cover, cover),
         notes = CASE WHEN excluded.notes <> '' THEN excluded.notes ELSE notes END`
    ).bind(
      id, n, edition, owned ? 1 : 0, owned ? 0 : wanted ? 1 : 0, numbers.length === 1 ? isbn : null,
      detail("title"), detail("publisher"), detail("language"), detail("condition"), detail("location"),
      detail("cover") || null, detail("notes")
    )
  );
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return c.json({ ...toSeries((await ownSeries(c, id))!), volumes: await volumesOf(c, id) });
});

async function ownVolume(c: Ctx, id: number) {
  return c.env.DB.prepare(
    "SELECT v.* FROM library_volumes v JOIN library_series s ON s.id = v.series_id WHERE v.id = ? AND s.user_id = ?"
  )
    .bind(id, userId(c))
    .first<VolumeRow>();
}

library.put("/library/volumes/:id{[0-9]+}", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  const row = await ownVolume(c, id);
  if (!row) return c.json({ message: "Cilt bulunamadı" }, 404);
  const body = await readJson(c);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const text = (key: string, col: string) => {
    if (field(body, key) !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(str(field(body, key)).trim());
    }
  };
  text("title", "title");
  text("publisher", "publisher");
  text("language", "language");
  text("condition", "condition");
  text("location", "location");
  text("notes", "notes");
  text("edition", "edition");
  if (field(body, "isbn") !== undefined) {
    sets.push("isbn = ?");
    vals.push(str(field(body, "isbn")).replace(/[-\s]/g, "") || null);
  }
  if (field(body, "cover") !== undefined) {
    sets.push("cover = ?");
    vals.push(str(field(body, "cover")) || null);
  }
  if (field(body, "owned") !== undefined) {
    const owned = bool(field(body, "owned"));
    sets.push("owned = ?");
    vals.push(owned ? 1 : 0);
    if (owned) sets.push("wanted = 0");
  }
  if (field(body, "wanted") !== undefined && !(field(body, "owned") !== undefined && bool(field(body, "owned")))) {
    sets.push("wanted = ?");
    vals.push(bool(field(body, "wanted")) ? 1 : 0);
  }
  if (sets.length) {
    try {
      await c.env.DB.prepare(`UPDATE library_volumes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
    } catch {
      return c.json({ message: "Bu cilt ve baskı zaten kayıtlı" }, 409 as 400);
    }
  }
  return c.json(toVolume((await ownVolume(c, id))!));
});

library.delete("/library/volumes/:id{[0-9]+}", requireAuth, async (c) => {
  const id = int(c.req.param("id"));
  if (await ownVolume(c, id)) await c.env.DB.prepare("DELETE FROM library_volumes WHERE id = ?").bind(id).run();
  return c.json({ message: "OK" });
});

/** Looks an ISBN up among the caller's own volumes (used by barcode entry to spot duplicates) */
library.get("/library/isbn/:isbn", requireAuth, async (c) => {
  const isbn = c.req.param("isbn").replace(/[-\s]/g, "");
  const row = await c.env.DB.prepare(
    `SELECT v.id, v.volume_number, v.owned, s.id AS series_id, s.title AS series_title
     FROM library_volumes v JOIN library_series s ON s.id = v.series_id WHERE s.user_id = ? AND v.isbn = ? LIMIT 1`
  )
    .bind(userId(c), isbn)
    .first<{ id: number; volume_number: number; owned: number; series_id: number; series_title: string }>();
  return c.json(row ? { found: true, volumeId: row.id, number: row.volume_number, owned: Boolean(row.owned), seriesId: row.series_id, seriesTitle: row.series_title } : { found: false });
});
