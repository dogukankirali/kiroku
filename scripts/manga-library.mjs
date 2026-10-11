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
// --writable (yalnızca --key ile): kütüphaneye yazmaya da izin verir.
//   PUT /<yol>                      → dosya yazar (eklentinin manga indirmesi NAS'a böyle gelir: .cbz, .json, .xml, görsel, altyazı)
//   GET /__subs/providers           → altyazı kaynakları (anisub için ANISUB_TOKEN; opensubtitles için OPENSUBTITLES_API_KEY,
//                                     OPENSUBTITLES_USER, OPENSUBTITLES_PASS ortam değişkenleri)
//   GET /__subs/search?q=&lang=&season=&episode=&provider=   → altyazı arar
//   POST /__subs/save?provider=&id=&lang=&file=<video yolu>  → altyazıyı indirip videonun yanına "<ad>.<dil>.srt" olarak kaydeder
//
// Kullanım: node scripts/manga-library.mjs [klasör] [--port 8788] [--key <anahtar>] [--writable]
//   klasör varsayılanı: <kullanıcı>/Downloads/Kiroku/Manga (Manga İndirici'nin kaydettiği yer)
//   Anime için örnek: node scripts/manga-library.mjs "D:/Anime" --port 8789

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep, extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import { pipeline } from "node:stream/promises";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(option("--port") ?? 8788);
const key = option("--key") ?? "";
const writable = args.includes("--writable");
if (writable && !key) {
  console.error("--writable yalnızca --key ile kullanılabilir (anahtarsız yazma herkese açık olurdu).");
  process.exit(1);
}
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
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Authorization, Range, Content-Type",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
};

// ---- Yazma: PUT ile dosya yükleme ----

const WRITE_TYPES = new Set([".cbz", ".json", ".xml", ".jpg", ".jpeg", ".png", ".webp", ".srt", ".vtt", ".ass"]);
const MAX_UPLOAD = 1024 * 1024 * 1024;

/** Kök içinde kalan mutlak yol; dışına çıkıyorsa null */
function inRoot(path) {
  const target = resolve(join(root, path));
  return target === root || target.startsWith(root + sep) ? target : null;
}

async function handlePut(req, res, path) {
  const target = inRoot(path);
  if (!writable) return res.writeHead(403, cors).end();
  if (!target || target === root || !WRITE_TYPES.has(extname(target).toLowerCase())) return res.writeHead(400, cors).end();
  if (Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD) return res.writeHead(413, cors).end();
  const tmp = `${target}.part-${process.pid}`;
  try {
    await mkdir(dirname(target), { recursive: true });
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) req.destroy();
    });
    await pipeline(req, createWriteStream(tmp));
    await rename(tmp, target);
    res.writeHead(201, { ...cors, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ path, size }));
  } catch {
    await rm(tmp, { force: true });
    if (!res.headersSent) res.writeHead(500, cors).end();
  }
}

// ---- Altyazı arama ve indirme ----

const UA = "Kiroku Library v1";
const OPENSUBTITLES_URL = process.env.OPENSUBTITLES_URL ?? "https://api.opensubtitles.com/api/v1";
const PODNAPISI_URL = process.env.PODNAPISI_URL ?? "https://www.podnapisi.net";
const ANISUB_URL = process.env.ANISUB_URL ?? "https://anisub.co";
const anisubToken = process.env.ANISUB_TOKEN ?? "";
const osKey = process.env.OPENSUBTITLES_API_KEY ?? "";
const osUser = process.env.OPENSUBTITLES_USER ?? "";
const osPass = process.env.OPENSUBTITLES_PASS ?? "";
let osToken = { value: "", at: 0 };

const hasOpenSubtitles = () => Boolean(osKey && osUser && osPass);
// AniSub (Turkish first, token needed) and OpenSubtitles when configured; Podnapisi only when asked for (PODNAPISI=1) or when nothing else is set up
const subProviders = () => [
  ...(anisubToken ? ["anisub"] : []),
  ...(hasOpenSubtitles() ? ["opensubtitles"] : []),
  ...(process.env.PODNAPISI === "1" || (!anisubToken && !hasOpenSubtitles()) ? ["podnapisi"] : []),
];

const LANG_NAMES = { tr: "türkçe", en: "ingilizce", ja: "japonca", de: "almanca", fr: "fransızca", es: "ispanyolca", it: "italyanca", pt: "portekizce", ru: "rusça", ar: "arapça" };

/** fetch'in "fetch failed" gibi anlamsız mesajı yerine asıl nedeni (DNS, TLS, zaman aşımı…) gösterir */
async function fetchDetailed(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = err?.cause?.code ?? err?.cause?.message ?? err?.name ?? "";
    throw new Error(`${new URL(String(url)).hostname} bağlantı hatası${cause ? ` (${cause})` : ""}`);
  }
}

async function getJson(url, init = {}) {
  const res = await fetchDetailed(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

async function openSubtitlesToken() {
  if (osToken.value && Date.now() - osToken.at < 3600_000) return osToken.value;
  const data = await getJson(`${OPENSUBTITLES_URL}/login`, {
    method: "POST",
    headers: { "Api-Key": osKey, "Content-Type": "application/json" },
    body: JSON.stringify({ username: osUser, password: osPass }),
  });
  osToken = { value: data.token, at: Date.now() };
  return osToken.value;
}

/** Sonuç biçimi: { id, name, lang, downloads, provider } */
async function searchSubtitles({ provider, q, lang, season, episode }) {
  if (provider === "anisub") {
    const url = new URL(`${ANISUB_URL}/api/subtitles`);
    url.searchParams.set("q", q);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("sort", "downloads");
    const data = await getJson(url);
    const wanted = LANG_NAMES[lang];
    const epNum = Number(episode) || 0;
    const rows = (data.data ?? [])
      .filter((a) => !wanted || String(a.subtitle_language ?? "").toLocaleLowerCase("tr") === wanted)
      .map((a) => {
        const n = Number(/(\d+)/.exec(a.content_type ?? "")?.[1] ?? 0);
        return { rank: epNum && n === epNum ? 0 : 1, hit: { id: String(a.subtitle_id), name: [a.subtitle_release_name, a.content_type, a.format, a.is_ai_translated ? "AI çeviri" : ""].filter(Boolean).join(" · "), lang, downloads: a.downloads_count ?? 0, provider } };
      });
    // Exact episode matches first; the server's download order is kept inside each group
    return rows.sort((x, y) => x.rank - y.rank).map((r) => r.hit);
  }
  if (provider === "opensubtitles") {
    const url = new URL(`${OPENSUBTITLES_URL}/subtitles`);
    url.searchParams.set("query", q);
    url.searchParams.set("languages", lang);
    if (episode) url.searchParams.set("episode_number", episode);
    if (season) url.searchParams.set("season_number", season);
    url.searchParams.set("order_by", "download_count");
    const data = await getJson(url, { headers: { "Api-Key": osKey } });
    return (data.data ?? []).flatMap((item) => {
      const a = item.attributes ?? {};
      const file = (a.files ?? [])[0];
      return file ? [{ id: String(file.file_id), name: a.release || file.file_name || a.feature_details?.title || "", lang: a.language ?? lang, downloads: a.download_count ?? 0, provider }] : [];
    });
  }
  const url = new URL(`${PODNAPISI_URL}/subtitles/search/advanced`);
  url.searchParams.set("keywords", q);
  url.searchParams.set("language", lang);
  if (season) url.searchParams.set("seasons", season);
  if (episode) url.searchParams.set("episodes", episode);
  const data = await getJson(url);
  return (data.data ?? []).map((item) => {
    const releases = item.custom_releases?.length ? item.custom_releases : (item.releases ?? []);
    const release = Array.isArray(releases) ? releases.map((r) => (typeof r === "string" ? r : r.name ?? "")).filter(Boolean).join(" · ") : "";
    return { id: String(item.id), name: [item.title, item.year, release].filter(Boolean).join(" · "), lang: item.language ?? lang, downloads: item.stats?.downloads ?? item.downloads ?? 0, provider };
  });
}

async function downloadSubtitle({ provider, id, episode }) {
  if (provider === "anisub") {
    const ep = Number(episode) > 0 ? `?episode=${Number(episode)}` : "";
    const endpoint = `${ANISUB_URL}/api/integrations/subtitles/${encodeURIComponent(id)}/download`;
    const auth = { headers: { Authorization: `Bearer ${anisubToken}` } };
    // ?episode= only applies to ZIP packs; if the API rejects it for a single file, ask again without it
    const info = await getJson(endpoint + ep, auth).catch((err) => (ep ? getJson(endpoint, auth) : Promise.reject(err)));
    const link = info.data?.download_url;
    if (!link) throw new Error("anisub indirme adresi vermedi");
    const res = await fetchDetailed(link, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`anisub dosya ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), name: info.data.filename ?? "" };
  }
  if (provider === "opensubtitles") {
    const token = await openSubtitlesToken();
    const info = await getJson(`${OPENSUBTITLES_URL}/download`, {
      method: "POST",
      headers: { "Api-Key": osKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: Number(id) }),
    });
    const res = await fetchDetailed(info.link, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`opensubtitles dosya ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), name: info.file_name ?? "" };
  }
  const res = await fetchDetailed(`${PODNAPISI_URL}/subtitles/${encodeURIComponent(id)}/download?container=zip`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`podnapisi dosya ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), name: "" };
}

/** Zip içindeki ilk altyazı dosyası { name, bytes } (yalnızca saklı/deflate girdiler) */
function firstSubtitleInZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count && buf.readUInt32LE(pos) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(pos + 10);
    const compressed = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    if (!/\.(srt|ass|ssa|vtt|sub)$/i.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    return { name, bytes: method === 0 ? data : method === 8 ? inflateRawSync(data) : null };
  }
  return null;
}

/** Metin altyazıyı UTF-8'e çevirir (Türkçe altyazılar çoğu zaman Windows-1254'tür) */
function toUtf8(bytes, lang) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder(lang === "tr" ? "windows-1254" : "windows-1252").decode(bytes);
  }
}

/** İlk altyazı dosyasını RAR paketinden çıkarır (imajda unrar varsa) */
async function firstSubtitleInRar(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "kiroku-rar-"));
  try {
    const archive = join(dir, "a.rar");
    await writeFile(archive, bytes);
    const list = spawnSync("unrar", ["lb", archive], { encoding: "utf8" });
    if (list.error) throw new Error("RAR paketi için sunucuda unrar gerekli (imajı güncel Dockerfile ile yeniden derle)");
    const name = list.stdout.split("\n").map((l) => l.trim()).find((l) => /\.(srt|ass|ssa|vtt)$/i.test(l));
    if (!name) return null;
    const out = spawnSync("unrar", ["p", "-inul", archive, name], { maxBuffer: 20 * 1024 * 1024 });
    return out.status === 0 && out.stdout.length ? { name, bytes: out.stdout } : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function saveSubtitle({ provider, id, lang, file, episode }) {
  const video = inRoot(file);
  if (!video || !/\.(mp4|m4v|webm|mkv|mov|ogv)$/i.test(video)) throw new Error("geçersiz video yolu");
  await stat(video);
  const got = await downloadSubtitle({ provider, id, episode });
  const isRar = got.bytes.subarray(0, 4).toString("latin1") === "Rar!";
  const entry = got.bytes[0] === 0x50 && got.bytes[1] === 0x4b ? firstSubtitleInZip(got.bytes) : isRar ? await firstSubtitleInRar(got.bytes) : { name: got.name, bytes: got.bytes };
  if (!entry?.bytes) throw new Error("indirilen dosyada altyazı bulunamadı");
  let ext = extname(entry.name).toLowerCase();
  ext = [".srt", ".ass", ".ssa", ".vtt"].includes(ext) ? ext : ".srt";
  let text = toUtf8(entry.bytes, lang);
  if ((ext === ".ass" || ext === ".ssa") && hasFfmpeg) {
    const proc = spawnSync("ffmpeg", ["-v", "error", "-f", "ass", "-i", "pipe:0", "-f", "srt", "pipe:1"], { input: Buffer.from(text), maxBuffer: 20 * 1024 * 1024 });
    if (proc.status === 0 && proc.stdout.length) {
      text = proc.stdout.toString("utf8");
      ext = ".srt";
    }
  }
  const stem = basename(video).replace(/\.[^.]+$/, "");
  const name = `${stem}.${lang}${ext}`;
  await writeFile(join(dirname(video), name), text);
  return name;
}

async function handleSubs(req, res, url, path) {
  const json = (code, body) => res.writeHead(code, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body));
  const q = url.searchParams;
  try {
    if (path === "/__subs/providers") return json(200, { writable, providers: subProviders() });
    const provider = subProviders().includes(q.get("provider") ?? "") ? q.get("provider") : "podnapisi";
    const lang = /^[a-z]{2,3}$/i.test(q.get("lang") ?? "") ? q.get("lang").toLowerCase() : "tr";
    if (path === "/__subs/search") {
      if (!q.get("q")) return json(400, { error: "q gerekli" });
      return json(200, await searchSubtitles({ provider, q: q.get("q"), lang, season: q.get("season"), episode: q.get("episode") }));
    }
    if (path === "/__subs/save" && req.method === "POST") {
      if (!writable) return json(403, { error: "sunucu --writable ile başlatılmadı" });
      return json(200, { saved: await saveSubtitle({ provider, id: q.get("id") ?? "", lang, file: q.get("file") ?? "", episode: q.get("episode") ?? "" }) });
    }
    return json(404, { error: "bilinmeyen yol" });
  } catch (err) {
    return json(502, { error: String(err?.message ?? err) });
  }
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  const reqUrl = new URL(req.url.replace(/^\/+/, "/"), "http://x");
  if (key && reqUrl.searchParams.get("key") !== key) return res.writeHead(401, cors).end();
  const path = decodeURIComponent(reqUrl.pathname);
  if (path.startsWith("/__subs/")) return handleSubs(req, res, reqUrl, path);
  if (req.method === "PUT") return handlePut(req, res, path);
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405, cors).end();
  const target = inRoot(path);
  // Kök dışına çıkmaya (../) izin verme
  if (!target) return res.writeHead(403, cors).end();

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
          ["-v", "error", "-ss", String(start), "-i", target, "-map", "0:v:0", "-map", `0:a:${a}`,
           ...(q.has("compat") ? ["-vf", `scale=-2:'min(${Math.min(2160, Math.max(240, Math.round(Number(q.get("compat"))) || 720))},ih)',format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "48", "-sc_threshold", "0"] : ["-c:v", "copy"]),
           "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-sn",
           "-avoid_negative_ts", "make_zero", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"],
          { stdio: ["ignore", "pipe", "pipe"] }
        );
        // ffmpeg hata verirse docker logs'ta görünsün (tarayıcıdan kapanma = bizim SIGKILL'imiz, hata sayılmaz)
        let errTail = "";
        let closedByClient = false;
        proc.stderr.on("data", (d) => (errTail = (errTail + d).slice(-1500)));
        proc.on("close", (code) => {
          if (code && !closedByClient) console.error(`ffmpeg çıkış ${code} (${path}, ses ${a}, başlangıç ${start}${q.has("compat") ? ", uyumlu mod" : ""}):\n${errTail}`);
        });
        res.writeHead(200, { ...cors, "Content-Type": "video/mp4", "Cache-Control": "no-store" });
        proc.stdout.pipe(res);
        const stop = () => {
          closedByClient = true;
          proc.kill("SIGKILL");
        };
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
  console.log(`Kütüphane: http://localhost:${port}  →  ${root}${key ? "  (erişim anahtarı gerekli)" : ""}${hasFfmpeg ? "  (ses/altyazı izleri açık)" : ""}${writable ? "  (yazılabilir)" : ""}`);
});
