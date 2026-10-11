#!/usr/bin/env node
// Manga kütüphanesini (CBZ klasörü) okuyucuya HTTP ile sunan geliştirme sunucusu.
// Klasör listesi Caddy'nin `file_server browse` JSON çıktısıyla aynı biçimde döner
// (Accept: application/json → [{ name, size, url, mod_time, is_dir }]); prod'da aynı klasör
// Caddy + Cloudflare Tunnel ile sunulduğunda okuyucu değişmeden çalışır.
//
// Salon için anime video klasörünü de sunar: Range istekleri (video sarma) desteklenir. <video> etiketi
// Authorization başlığı gönderemediği için --key verilirse her istek ?key=<anahtar> ister.
//
// ffmpeg + ffprobe kuruluysa Salon için dosyanın içindeki ses ve altyazı izleri de sunulur:
//   <dosya>?tracks=1          → izlerin listesi (JSON)
//   <dosya>?sub=<n>           → n. altyazı izi WebVTT olarak
//   <dosya>?keyframe=s        → s. saniyeden önceki en yakın anahtar kare (akış tam orada başlayabilsin diye)
//   <dosya>?audio=<n>&start=s → n. ses izi, s. saniyeden başlayan MP4 akışı (video aynen kopyalanır, ses AAC'ye çevrilir)
//
// Kullanım: node scripts/manga-library.mjs [klasör] [--port 8788] [--key <anahtar>]
//   klasör varsayılanı: <kullanıcı>/Downloads/Kiroku/Manga (Manga İndirici'nin kaydettiği yer)
//   Anime için örnek: node scripts/manga-library.mjs "D:/Anime" --port 8789

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep, extname } from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(option("--port") ?? 8788);
const key = option("--key") ?? "";
const rootArg = args.find((a, i) => !a.startsWith("--") && !["--port", "--key"].includes(args[i - 1]));
const root = resolve(rootArg ?? join(homedir(), "Downloads", "Kiroku", "Manga"));

const TYPES = {
  ".cbz": "application/vnd.comicbook+zip",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
  ".vtt": "text/vtt; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
};

const hasFfmpeg = ["ffprobe", "ffmpeg"].every((bin) => spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0);
const TEXT_SUBS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);
const probeCache = new Map();
const subCache = new Map();

function run(cmd, args, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolveRun(Buffer.concat(chunks)) : reject(new Error(`${cmd} ${code}`));
    });
  });
}

/** Dosyadaki ses/altyazı izleri; index, o türün kendi içindeki sıra (ffmpeg'in 0:a:n / 0:s:n haritası) */
async function probeTracks(target, mtimeMs) {
  const cached = probeCache.get(target);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;
  const out = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", target], 30000);
  const info = JSON.parse(out.toString("utf8"));
  const pick = (type) =>
    info.streams
      .filter((s) => s.codec_type === type)
      .map((s, index) => ({
        index,
        lang: String(s.tags?.language ?? "und").toLowerCase(),
        title: String(s.tags?.title ?? ""),
        codec: String(s.codec_name ?? ""),
        default: Boolean(s.disposition?.default),
        forced: Boolean(s.disposition?.forced),
        text: type === "subtitle" ? TEXT_SUBS.has(s.codec_name) : undefined,
      }));
  const value = { duration: Number(info.format?.duration) || 0, audio: pick("audio"), subtitles: pick("subtitle") };
  probeCache.set(target, { mtimeMs, value });
  return value;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Accept, Authorization, Range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
};

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405, cors).end();

  const reqUrl = new URL(req.url.replace(/^\/+/, "/"), "http://x");
  if (key && reqUrl.searchParams.get("key") !== key) return res.writeHead(401, cors).end();
  const path = decodeURIComponent(reqUrl.pathname);
  const target = resolve(join(root, path));
  // Kök dışına çıkmaya (../) izin verme
  if (target !== root && !target.startsWith(root + sep)) return res.writeHead(403, cors).end();

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      const entries = await Promise.all(
        (await readdir(target)).map(async (name) => {
          const s = await stat(join(target, name));
          return { name, size: s.size, url: `./${encodeURIComponent(name)}${s.isDirectory() ? "/" : ""}`, mod_time: s.mtime.toISOString(), is_dir: s.isDirectory() };
        })
      );
      res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(entries));
    }
    const q = reqUrl.searchParams;
    if (hasFfmpeg && (q.has("tracks") || q.has("sub") || q.has("audio") || q.has("keyframe"))) {
      const json = (code, body) => res.writeHead(code, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body));
      try {
        const tracks = await probeTracks(target, info.mtimeMs);
        if (q.has("tracks")) return json(200, tracks);
        if (q.has("sub")) {
          const n = Number(q.get("sub"));
          if (!tracks.subtitles[n]?.text) return json(404, { error: "no such text subtitle" });
          const cacheKey = `${target}|${info.mtimeMs}|${n}`;
          let vtt = subCache.get(cacheKey);
          if (!vtt) {
            vtt = await run("ffmpeg", ["-v", "error", "-i", target, "-map", `0:s:${n}`, "-f", "webvtt", "pipe:1"], 180000);
            subCache.set(cacheKey, vtt);
            if (subCache.size > 40) subCache.delete(subCache.keys().next().value);
          }
          return res.writeHead(200, { ...cors, "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, max-age=3600" }).end(vtt);
        }
        if (q.has("keyframe")) {
          const t = Math.max(0, Number(q.get("keyframe")) || 0);
          const lines = (
            await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-read_intervals", `${Math.max(0, t - 90)}%${t + 0.001}`, "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", target], 30000)
          )
            .toString("utf8")
            .split("\n");
          let best = 0;
          for (const line of lines) {
            const [pts, flags] = line.split(",");
            const time = Number(pts);
            if (flags?.includes("K") && Number.isFinite(time) && time <= t + 0.001 && time > best) best = time;
          }
          return json(200, { start: Math.ceil(best * 1000) / 1000 });
        }
        const a = Number(q.get("audio"));
        if (!tracks.audio[a]) return json(404, { error: "no such audio track" });
        const start = Math.max(0, Number(q.get("start")) || 0);
        // Video aynen kopyalanır (ucuz), seçilen ses AAC'ye çevrilir; parçalı MP4 olarak akar. Sarma, başka ?start= ile yeni akış demektir.
        const proc = spawn(
          "ffmpeg",
          ["-v", "error", "-ss", String(start), "-i", target, "-map", "0:v:0", "-map", `0:a:${a}`, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-sn",
           "-avoid_negative_ts", "make_zero", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"],
          { stdio: ["ignore", "pipe", "ignore"] }
        );
        res.writeHead(200, { ...cors, "Content-Type": "video/mp4", "Cache-Control": "no-store" });
        proc.stdout.pipe(res);
        const stop = () => proc.kill("SIGKILL");
        res.on("close", stop);
        proc.on("error", () => res.destroy());
        return;
      } catch {
        return json(500, { error: "ffmpeg failed" });
      }
    }
    const headers = {
      ...cors,
      "Content-Type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Last-Modified": info.mtime.toUTCString(),
    };
    // Range: bytes=start-end (video sarma); geçersiz aralıkta 416
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start >= info.size || start > end) return res.writeHead(416, { ...cors, "Content-Range": `bytes */${info.size}` }).end();
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      const part = createReadStream(target, { start, end });
      res.on("close", () => part.destroy());
      return part.pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Length": info.size });
    if (req.method === "HEAD") return res.end();
    const whole = createReadStream(target);
    res.on("close", () => whole.destroy());
    whole.pipe(res);
  } catch {
    res.writeHead(404, cors).end();
  }
}).listen(port, () => {
  console.log(`Kütüphane: http://localhost:${port}  →  ${root}${key ? "  (erişim anahtarı gerekli)" : ""}${hasFfmpeg ? "  (ses/altyazı izleri açık)" : ""}`);
});
