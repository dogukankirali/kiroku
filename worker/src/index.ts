import { Hono } from "hono";
import { cors } from "hono/cors";
import { airingEnabled, airingRoutes, runAiringCheck } from "./airing";
import { anilistRoutes } from "./anilist";
import { anime } from "./anime";
import { coverRoutes } from "./covers";
import { titleRoutes } from "./titles";
import { googleRoutes } from "./google";
import { manga } from "./manga";
import { screen } from "./screen";
import { books } from "./books";
import { library } from "./library";
import { chapters } from "./chapters";
import { profileRoutes } from "./profile";
import { users } from "./users";
import type { AppEnv } from "./util";
import { watchlist } from "./watchlist";

// Tek Worker: Next.js statik çıktısı assets olarak sunulur, yalnızca /api/* bu koda düşer
// (wrangler.jsonc → assets.run_worker_first).

const api = new Hono<AppEnv>();
api.get("/healthcheck", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.text("OK");
});
api.route("/", anime);
api.route("/", watchlist);
api.route("/", manga);
api.route("/", screen);
api.route("/", books);
api.route("/", library);
api.route("/", chapters);
api.route("/", users);
api.route("/", anilistRoutes);
api.route("/", coverRoutes);
api.route("/", titleRoutes);
api.route("/", googleRoutes);
api.route("/", profileRoutes);
api.route("/", airingRoutes);

const app = new Hono<AppEnv>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.route("/api", api);

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ message: "Bulunamadı" }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError((err, c) => {
  console.error(err);
  return c.json({ message: "Sunucu hatası oluştu" }, 500);
});

// Eski camelCase yollar (yüklü eski eklenti sürümleri, önbellekteki istemciler) kebab-case karşılıklarına yönlenir
const LEGACY_PATHS: Record<string, string> = {
  "/api/getAnimeTable": "/api/get-anime-table",
  "/api/getAnimeById": "/api/get-anime-by-id",
  "/api/animeCover": "/api/anime-cover",
  "/api/createAnime": "/api/create-anime",
  "/api/createAnimeWithFile": "/api/create-anime-with-file",
  "/api/updateAnimeTable": "/api/update-anime-table",
  "/api/myAnime/dates": "/api/my-anime/dates",
  "/api/deleteAnime": "/api/delete-anime",
  "/api/getGenres": "/api/get-genres",
  "/api/getSeries": "/api/get-series",
  "/api/updateFinishedAnimeStatus": "/api/update-finished-anime-status",
  "/api/updateAnimeStatus": "/api/anime/update-episode",
};

export default {
  fetch(req: Request, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    const url = new URL(req.url);
    const target = LEGACY_PATHS[url.pathname];
    if (target) {
      url.pathname = target;
      req = new Request(url, req);
    }
    return app.fetch(req, env, ctx);
  },
  // Cloudflare Cron Trigger (wrangler.jsonc → triggers.crons): yayın takibi ve yeni bölüm bildirimleri
  scheduled(_controller: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(
      airingEnabled(env)
        .then(async (on) => {
          if (on) await runAiringCheck(env, env.APP_URL ?? "");
          else console.log("[airing] kapalı, atlandı");
        })
        .catch((err) => console.error("[airing] cron hatası:", err))
    );
  },
};
