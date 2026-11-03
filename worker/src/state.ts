import { Hono } from "hono";
import { requireAuth } from "./auth";
import { readJson, str, type AppEnv } from "./util";

// Per-user synced state (/api/state): small JSON values keyed by name, e.g. "salon.prefs",
// "salon.pos:12:ep01.mkv", "continue.watch". Last write wins per key.

export const stateRoutes = new Hono<AppEnv>();

const KEY_RE = /^[A-Za-z0-9._:@\- ]{1,160}$/;
const MAX_VALUE = 64 * 1024;
const MAX_KEYS = 5000;

// All of the caller's keys (optionally those starting with ?prefix=), newest first
stateRoutes.get("/state", requireAuth, async (c) => {
  const userId = c.get("user")!.userId;
  const prefix = c.req.query("prefix") ?? "";
  const { results } = await c.env.DB.prepare("SELECT key, value, updated_at FROM user_state WHERE user_id = ? AND substr(key, 1, ?) = ? ORDER BY updated_at DESC LIMIT 2000")
    .bind(userId, prefix.length, prefix)
    .all<{ key: string; value: string; updated_at: string }>();
  return c.json({ data: results.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at })) });
});

// Writes one key; { value: string } (null deletes). Several keys at once: PUT /state with { items: [{key,value}] }
async function putOne(c: Parameters<typeof requireAuth>[0], userId: number, key: string, value: unknown) {
  if (!KEY_RE.test(key)) return "Geçersiz anahtar";
  if (value === null || value === undefined) {
    await c.env.DB.prepare("DELETE FROM user_state WHERE user_id = ? AND key = ?").bind(userId, key).run();
    return "";
  }
  const text = str(value);
  if (text.length > MAX_VALUE) return "Değer çok büyük";
  await c.env.DB.prepare(
    `INSERT INTO user_state (user_id, key, value) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  )
    .bind(userId, key, text)
    .run();
  return "";
}

stateRoutes.put("/state", requireAuth, async (c) => {
  const userId = c.get("user")!.userId;
  const body = await readJson(c);
  const items = Array.isArray(body.items) ? (body.items as { key?: unknown; value?: unknown }[]).slice(0, 100) : [];
  if (!items.length) return c.json({ message: "items boş" }, 400);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM user_state WHERE user_id = ?").bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) > MAX_KEYS) return c.json({ message: "Kayıt sınırı aşıldı" }, 400);
  for (const item of items) {
    const error = await putOne(c, userId, str(item.key), item.value);
    if (error) return c.json({ message: error }, 400);
  }
  return c.json({ ok: true });
});
