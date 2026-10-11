import { Hono, type MiddlewareHandler } from "hono";
import { requireAdmin, requireAuth } from "./auth";
import { statusLabel } from "./anilist";
import { pushConfigured, pushToUser, type PushPayload } from "./push";
import { bool, field, int, num, readJson, str, type AppEnv, type Env } from "./util";

// Yayın takibi (#19). Cloudflare Cron Trigger (wrangler.jsonc → triggers.crons) her 3 saatte bir çalışır:
// yayındaki animelerin durumunu, bölüm sayısını, puanını ve sıradaki bölümünü Kitsu'dan alır (ücretsiz,
// anahtarsız; AniList Workers'ı engellediği için Kitsu). Yeni bölüm çıkınca, animeyi listesinde tutan
// kullanıcılara Kiroku içi bildirim yazılır; bildirimi açık olanlara tarayıcı bildirimi (Web Push) gider.
// Eski GitHub Actions yolu (AniList, POST /cron/airing) yedek olarak durur.

export const airingRoutes = new Hono<AppEnv>();

const requireCron: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.env.CRON_SECRET;
  const given = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length) return c.json({ error: "Yetkisiz" }, 401);
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff) return c.json({ error: "Yetkisiz" }, 401);
  await next();
};

const malId = (link: string | null) => {
  const m = /myanimelist\.net\/anime\/(\d+)/.exec(link ?? "");
  return m ? Number(m[1]) : null;
};

const CANDIDATES = `SELECT id, name, mal_anime_link, anilist_id, kitsu_id, aired_episodes, next_episode_at, total_number_of_episodes, airing_checked_at
  FROM animes WHERE anime_status IN ('Currently Airing', 'Not yet aired') OR next_episode IS NOT NULL ORDER BY id`;

type Candidate = {
  id: number;
  name: string;
  mal_anime_link: string | null;
  anilist_id: number | null;
  kitsu_id: number | null;
  aired_episodes: number | null;
  next_episode_at: string | null;
  total_number_of_episodes: number | null;
};

/** Kaynaktan bağımsız güncelleme: bir animenin yeni yayın bilgisi */
type AiringUpdate = {
  id: number;
  status: string; // "Currently Airing" | "Finished" | "Not yet aired" | ""
  episodes: number; // toplam bölüm (0 = bilinmiyor)
  score: number; // 0-10 (0 = bilinmiyor)
  nextEpisode: number | null;
  nextEpisodeAt: string | null;
  aired: number | null;
  startDate?: string;
  anilistId?: number;
  kitsuId?: number;
};

type NewEpisode = { animeId: number; name: string; from: number; to: number };

/** Güncellemeleri yazar, yeni bölüm çıkanları bildirir */
async function applyUpdates(env: Env, updates: AiringUpdate[], origin: string) {
  const db = env.DB;
  const rows = new Map<number, { name: string; aired_episodes: number | null }>();
  for (let i = 0; i < updates.length; i += 90) {
    const ids = updates.slice(i, i + 90).map((u) => u.id);
    const { results } = await db
      .prepare(`SELECT id, name, aired_episodes FROM animes WHERE id IN (${ids.map(() => "?").join(", ")})`)
      .bind(...ids)
      .all<{ id: number; name: string; aired_episodes: number | null }>();
    for (const r of results) rows.set(r.id, r);
  }

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  const fresh: NewEpisode[] = [];
  for (const u of updates) {
    const row = rows.get(u.id);
    if (!row) continue;
    // İlk kontrolde (aired_episodes boş) yalnızca başlangıç değeri yazılır, bildirim gitmez
    if (row.aired_episodes != null && u.aired != null && u.aired > row.aired_episodes) {
      fresh.push({ animeId: u.id, name: row.name, from: row.aired_episodes + 1, to: u.aired });
    }
    stmts.push(
      db
        .prepare(
          `UPDATE animes SET anilist_id = COALESCE(?, anilist_id), kitsu_id = COALESCE(?, kitsu_id),
             anime_status = CASE WHEN ? <> '' THEN ? ELSE anime_status END,
             total_number_of_episodes = CASE WHEN ? > 0 THEN ? ELSE total_number_of_episodes END,
             mal_score = CASE WHEN ? > 0 THEN ? ELSE mal_score END,
             next_episode = ?, next_episode_at = ?, aired_episodes = COALESCE(?, aired_episodes), airing_checked_at = ?,
             start_date = COALESCE(NULLIF(?, ''), start_date)
           WHERE id = ?`
        )
        .bind(
          u.anilistId ?? null, u.kitsuId ?? null,
          u.status, u.status,
          u.episodes, u.episodes,
          u.score, u.score,
          u.nextEpisode, u.nextEpisodeAt, u.aired, now,
          u.startDate ?? "",
          u.id
        )
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  const notified = fresh.length ? await notify(env, fresh, origin) : { inApp: 0, pushed: 0 };
  return { updated: stmts.length, newEpisodes: fresh.length, ...notified, episodes: fresh };
}

const episodeText = (a: NewEpisode) => (a.from === a.to ? `${a.to}. bölüm` : `${a.from}–${a.to}. bölümler`);

/**
 * Animeyi listesinde tutan (izliyor ya da Plan to Watch) her kullanıcıya Kiroku içi bildirim yazar;
 * bildirimi açık olanlara tek bir tarayıcı bildirimi gönderir.
 */
async function notify(env: Env, fresh: NewEpisode[], origin: string) {
  const ids = fresh.map((f) => f.animeId);
  const { results } = await env.DB.prepare(
    `SELECT u.id AS user_id, u.notify_new_episodes AS notify, ua.anime_id FROM users u
     JOIN user_anime ua ON ua.user_id = u.id
     WHERE u.is_active = 1 AND (ua.watch_status <> 0 OR ua.plan_to_watch = 1 OR ua.wait_list = 1)
       AND ua.anime_id IN (${ids.map(() => "?").join(", ")})`
  )
    .bind(...ids)
    .all<{ user_id: number; notify: number; anime_id: number }>();

  const app = (env.APP_URL || origin).replace(/\/+$/, "");
  const byUser = new Map<number, { notify: boolean; animes: NewEpisode[] }>();
  const inserts: D1PreparedStatement[] = [];
  for (const r of results) {
    const a = fresh.find((f) => f.animeId === r.anime_id)!;
    const entry = byUser.get(r.user_id) ?? { notify: Boolean(r.notify), animes: [] };
    entry.animes.push(a);
    byUser.set(r.user_id, entry);
    inserts.push(
      env.DB.prepare("INSERT INTO notifications (user_id, anime_id, title, body, url) VALUES (?, ?, ?, ?, ?)").bind(
        r.user_id, a.animeId, a.name, `${episodeText(a)} yayınlandı`, `/anime/detail?id=${a.animeId}`
      )
    );
  }
  for (let i = 0; i < inserts.length; i += 50) await env.DB.batch(inserts.slice(i, i + 50));

  let pushed = 0;
  if (pushConfigured(env)) {
    for (const [userId, { notify: on, animes }] of byUser) {
      if (!on) continue;
      const payload: PushPayload =
        animes.length === 1
          ? { title: animes[0].name, body: `${episodeText(animes[0])} yayınlandı`, url: `${app}/anime/detail?id=${animes[0].animeId}`, tag: `anime-${animes[0].animeId}` }
          : { title: `${animes.length} animede yeni bölüm`, body: animes.map((a) => `${a.name} · ${episodeText(a)}`).join("\n"), url: `${app}/`, tag: "new-episodes" };
      pushed += await pushToUser(env, userId, payload);
    }
  }
  return { inApp: inserts.length, pushed };
}

// ------------------------------ Kitsu (Cloudflare Cron) ------------------------------

const KITSU = "https://kitsu.io/api/edge";
const KITSU_HEADERS = { Accept: "application/vnd.api+json" };
// Ücretsiz plan: çalıştırma başına en fazla 50 dış istek. Eşleme ve bölüm sayımı bu sınıra göre bölünür;
// en uzun süredir kontrol edilmeyenler önce gelir, kalanlar sonraki çalıştırmaya kalır.
const MAX_MAPPING_REQUESTS = 5;
const MAX_EPISODE_LOOKUPS = 25;

async function kitsu<T>(path: string): Promise<T> {
  const res = await fetch(`${KITSU}${path}`, { headers: KITSU_HEADERS });
  if (!res.ok) throw new Error(`Kitsu ${res.status} ${path.slice(0, 80)}`);
  return (await res.json()) as T;
}

const kitsuStatus = (s: string | null | undefined) =>
  s === "current" ? "Currently Airing" : s === "finished" ? "Finished" : s === "upcoming" || s === "unreleased" || s === "tba" ? "Not yet aired" : "";

/**
 * Yayınlanmış son bölüm ve (varsa) sıradakinin tarihi. Kitsu ileri bölümleri tarihsiz yer tutucu olarak
 * listeleyebildiği için tarihli bölüm varsa yalnızca tarihi geçmişler sayılır; hiç tarih yoksa (uzun
 * soluklu seriler) listedeki son bölüm yayınlanmış kabul edilir.
 */
async function episodeState(kitsuId: number): Promise<{ aired: number | null; nextAt: string | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await kitsu<{ data: { attributes: { number: number | null; airdate: string | null } }[] }>(
    `/episodes?filter[mediaId]=${kitsuId}&filter[mediaType]=Anime&sort=-number&page[limit]=20&fields[episodes]=number,airdate`
  );
  const eps = res.data.map((e) => e.attributes).filter((e) => e.number != null) as { number: number; airdate: string | null }[];
  const dated = eps.filter((e) => e.airdate);
  if (!dated.length) return { aired: eps.length ? Math.max(...eps.map((e) => e.number)) : null, nextAt: null };
  const past = dated.filter((e) => e.airdate! <= today);
  const future = dated.filter((e) => e.airdate! > today).sort((x, y) => x.airdate!.localeCompare(y.airdate!));
  return {
    aired: past.length ? Math.max(...past.map((e) => e.number)) : 0,
    nextAt: future[0] ? `${future[0].airdate}T00:00:00.000Z` : null,
  };
}

/** Yayın takibi (cron) yalnızca bir admin açtıysa çalışır; varsayılan kapalı */
export async function airingEnabled(env: Env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'airing_enabled'").first<{ value: string }>();
  return row?.value === "1";
}

airingRoutes.get("/admin/airing", requireAdmin, async (c) => c.json({ enabled: await airingEnabled(c.env) }));

airingRoutes.put("/admin/airing", requireAdmin, async (c) => {
  const enabled = bool(field(await readJson(c), "enabled"));
  await c.env.DB.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('airing_enabled', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).bind(enabled ? "1" : "0").run();
  return c.json({ enabled });
});

export async function runAiringCheck(env: Env, origin = "") {
  const db = env.DB;
  const { results } = await db.prepare(CANDIDATES).all<Candidate & { airing_checked_at: string | null }>();
  // En uzun süredir kontrol edilmeyen önce
  const candidates = results.sort((a, b) => (a.airing_checked_at ?? "").localeCompare(b.airing_checked_at ?? ""));
  if (!candidates.length) return { checked: 0, updated: 0, newEpisodes: 0, inApp: 0, pushed: 0 };

  // 1) Kitsu kimliği olmayanları MAL ID'siyle toplu eşle
  const unmapped = candidates.filter((c) => !c.kitsu_id && malId(c.mal_anime_link));
  for (let i = 0; i < unmapped.length && i / 20 < MAX_MAPPING_REQUESTS; i += 20) {
    const group = unmapped.slice(i, i + 20);
    const ids = group.map((c) => malId(c.mal_anime_link)).join(",");
    try {
      const res = await kitsu<{ data: { attributes: { externalId: string }; relationships: { item: { data: { id: string } | null } } }[] }>(
        // include=item olmadan ilişki yalnızca bağlantı olarak gelir, anime kimliği gelmez
        `/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${ids}&include=item&fields[anime]=status&page[limit]=20`
      );
      for (const m of res.data) {
        const target = group.find((c) => String(malId(c.mal_anime_link)) === m.attributes.externalId);
        const kid = Number(m.relationships.item.data?.id);
        if (target && kid) target.kitsu_id = kid;
      }
    } catch (err) {
      console.error("[airing] Kitsu eşleme hatası:", err);
    }
  }

  // 2) Durum, toplam bölüm, puan ve sıradaki yayın tarihi: 20'şerli gruplar
  const mapped = candidates.filter((c) => c.kitsu_id);
  const info = new Map<number, { status: string; episodeCount: number | null; averageRating: string | null; nextRelease: string | null; startDate: string | null }>();
  for (let i = 0; i < mapped.length; i += 20) {
    const ids = mapped.slice(i, i + 20).map((c) => c.kitsu_id).join(",");
    try {
      const res = await kitsu<{ data: { id: string; attributes: { status: string; episodeCount: number | null; averageRating: string | null; nextRelease: string | null; startDate: string | null } }[] }>(
        `/anime?filter[id]=${ids}&page[limit]=20&fields[anime]=status,episodeCount,averageRating,nextRelease,startDate`
      );
      for (const a of res.data) info.set(Number(a.id), a.attributes);
    } catch (err) {
      console.error("[airing] Kitsu anime hatası:", err);
    }
  }

  // 3) Yayındakiler için bölüm listesinden yayınlanan bölüm sayısı
  const updates: AiringUpdate[] = [];
  let lookups = 0;
  for (const c of mapped) {
    const a = info.get(c.kitsu_id!);
    if (!a) continue;
    const episodes = a.episodeCount ?? 0;
    let aired: number | null = null;
    let nextAt = a.nextRelease ? new Date(a.nextRelease).toISOString() : null;
    if (a.status === "finished") {
      aired = episodes || c.aired_episodes;
      nextAt = null;
    } else if (a.status === "current") {
      // Bu çalıştırmada sığmayanlar güncellenmez; kontrol zamanı değişmediği için sonraki çalıştırmada önce onlar gelir
      if (lookups >= MAX_EPISODE_LOOKUPS) continue;
      lookups++;
      try {
        const state = await episodeState(c.kitsu_id!);
        aired = state.aired;
        nextAt ??= state.nextAt;
      } catch (err) {
        console.error(`[airing] Kitsu bölüm hatası (${c.name}):`, err);
        continue;
      }
    }
    if (aired != null && episodes) aired = Math.min(aired, episodes);
    // Kitsu bazen geri gidebilir (liste düzeltmesi); yayınlanan bölüm sayısı azalmaz
    if (aired != null && c.aired_episodes != null && aired < c.aired_episodes) aired = c.aired_episodes;
    updates.push({
      id: c.id,
      kitsuId: c.kitsu_id!,
      status: kitsuStatus(a.status),
      episodes,
      score: a.averageRating ? Number(a.averageRating) / 10 : 0,
      nextEpisode: nextAt && aired != null ? aired + 1 : null,
      nextEpisodeAt: nextAt,
      aired,
      startDate: a.startDate ?? "",
    });
  }
  const result = await applyUpdates(env, updates, origin);
  console.log(`[airing] ${candidates.length} aday, ${mapped.length} Kitsu eşli, ${result.updated} güncellendi, ${result.newEpisodes} yeni bölüm, ${result.pushed} bildirim`);
  return { checked: candidates.length, ...result };
}

// ------------------------------ GitHub Actions yedeği (AniList) ------------------------------

// Bitmemiş (yayında / henüz başlamamış) ya da sıradaki bölümü bilinen animeler
airingRoutes.get("/cron/airing", requireCron, async (c) => {
  const { results } = await c.env.DB.prepare(CANDIDATES).all<Candidate>();
  const items = results
    .map((r) => ({ id: r.id, name: r.name, idMal: malId(r.mal_anime_link), anilistId: r.anilist_id }))
    .filter((r) => r.idMal || r.anilistId);
  return c.json({ items });
});

type AiringMedia = {
  id: number;
  status: string | null;
  episodes: number | null;
  averageScore: number | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
};

function isAiringMedia(v: unknown): v is AiringMedia {
  const m = v as AiringMedia;
  return (
    !!m &&
    typeof m === "object" &&
    Number.isInteger(m.id) &&
    (m.status == null || typeof m.status === "string") &&
    (m.episodes == null || Number.isInteger(m.episodes)) &&
    (m.averageScore == null || typeof m.averageScore === "number") &&
    (m.nextAiringEpisode == null ||
      (Number.isInteger(m.nextAiringEpisode.episode) && Number.isInteger(m.nextAiringEpisode.airingAt)))
  );
}

// Gövde: { items: [{ id, media: AniList Media }] }
airingRoutes.post("/cron/airing", requireCron, async (c) => {
  const raw = field(await readJson(c), "items");
  const items = (Array.isArray(raw) ? raw : [])
    .map((it: Record<string, unknown>) => ({ id: int(it?.id, -1), media: it?.media }))
    .filter((it): it is { id: number; media: AiringMedia } => it.id >= 0 && isAiringMedia(it.media))
    .slice(0, 500);
  if (!items.length) return c.json({ updated: 0, newEpisodes: 0, inApp: 0, pushed: 0 });
  const current = new Map<number, number | null>();
  const { results } = await c.env.DB.prepare(CANDIDATES).all<Candidate>();
  for (const r of results) current.set(r.id, r.aired_episodes);
  const updates: AiringUpdate[] = items.map(({ id, media: m }) => {
    const next = m.nextAiringEpisode;
    return {
      id,
      anilistId: m.id,
      status: statusLabel(m.status),
      episodes: m.episodes ?? 0,
      score: num(m.averageScore) / 10,
      nextEpisode: next?.episode ?? null,
      nextEpisodeAt: next ? new Date(next.airingAt * 1000).toISOString() : null,
      aired: next ? Math.max(next.episode - 1, 0) : m.status === "FINISHED" ? m.episodes : (current.get(id) ?? null),
    };
  });
  return c.json(await applyUpdates(c.env, updates, new URL(c.req.url).origin));
});

// Admin: zamanlanmış kontrolü hemen çalıştır (cron'u beklemeden denemek için)
airingRoutes.post("/airing/run", requireAuth, async (c) => {
  if (!c.get("user")!.isAdmin) return c.json({ message: "Yalnızca admin" }, 403);
  return c.json(await runAiringCheck(c.env, new URL(c.req.url).origin));
});

// ------------------------------ Kiroku içi bildirimler ------------------------------

airingRoutes.get("/notifications", requireAuth, async (c) => {
  const userId = c.get("user")!.userId;
  const [list, unread] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, anime_id, title, body, url, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30").bind(userId),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(userId),
  ]);
  return c.json({
    unread: Number((unread.results?.[0] as { n: number } | undefined)?.n ?? 0),
    items: (list.results as { id: number; anime_id: number | null; title: string; body: string; url: string; read_at: string | null; created_at: string }[]).map((n) => ({
      id: n.id,
      animeId: n.anime_id,
      title: n.title,
      body: n.body,
      url: n.url,
      read: Boolean(n.read_at),
      createdAt: n.created_at,
    })),
  });
});

// Hepsini okundu yap (ya da { id } ile tek bildirimi)
airingRoutes.post("/notifications/read", requireAuth, async (c) => {
  const id = int(field(await readJson(c), "id"), 0);
  const userId = c.get("user")!.userId;
  await (id
    ? c.env.DB.prepare("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ? AND read_at IS NULL").bind(id, userId)
    : c.env.DB.prepare("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND read_at IS NULL").bind(userId)
  ).run();
  return c.json({ message: "OK" });
});

// ------------------------------ Tarayıcı bildirimi abonelikleri ------------------------------

airingRoutes.get("/push/public-key", requireAuth, (c) => c.json({ publicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : "" }));

// Gövde: tarayıcının PushSubscription.toJSON() çıktısı ({ endpoint, keys: { p256dh, auth } })
airingRoutes.post("/push/subscribe", requireAuth, async (c) => {
  const body = await readJson(c);
  const endpoint = str(field(body, "endpoint"));
  const keys = (field(body, "keys") ?? {}) as Record<string, unknown>;
  const p256dh = str(field(keys, "p256dh"));
  const auth = str(field(keys, "auth"));
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return c.json({ message: "Geçersiz abonelik" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`
  )
    .bind(c.get("user")!.userId, endpoint, p256dh, auth, (c.req.header("User-Agent") ?? "").slice(0, 200))
    .run();
  if (bool(field(body, "enableNotifications"))) {
    await c.env.DB.prepare("UPDATE users SET notify_new_episodes = 1 WHERE id = ?").bind(c.get("user")!.userId).run();
  }
  return c.json({ message: "OK" });
});

airingRoutes.post("/push/unsubscribe", requireAuth, async (c) => {
  const endpoint = str(field(await readJson(c), "endpoint"));
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, c.get("user")!.userId).run();
  return c.json({ message: "OK" });
});

// Kendine deneme bildirimi
airingRoutes.post("/push/test", requireAuth, async (c) => {
  if (!pushConfigured(c.env)) return c.json({ message: "Tarayıcı bildirimleri ayarlı değil (VAPID anahtarı yok)" }, 503);
  const sent = await pushToUser(c.env, c.get("user")!.userId, {
    title: "Kiroku",
    body: "Bildirimler açık. Yeni bölüm çıkınca buradan haber vereceğim.",
    url: `${(c.env.APP_URL || new URL(c.req.url).origin).replace(/\/+$/, "")}/profile`,
    tag: "test",
  });
  return sent ? c.json({ message: "OK", sent }) : c.json({ message: "Bu hesapta kayıtlı bir tarayıcı aboneliği yok ya da gönderilemedi" }, 404);
});
