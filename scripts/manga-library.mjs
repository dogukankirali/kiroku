#!/usr/bin/env node
// Manga kütüphanesini (CBZ klasörü) okuyucuya HTTP ile sunan geliştirme sunucusu.
// Klasör listesi Caddy'nin `file_server browse` JSON çıktısıyla aynı biçimde döner
// (Accept: application/json → [{ name, size, url, mod_time, is_dir }]); prod'da aynı klasör
// Caddy + Cloudflare Tunnel ile sunulduğunda okuyucu değişmeden çalışır.
//
// Salon için anime video klasörünü de sunar: Range istekleri (video sarma) desteklenir. <video> etiketi
// Authorization başlığı gönderemediği için --key verilirse her istek ?key=<anahtar> ister.
//
// Kullanım: node scripts/manga-library.mjs [klasör] [--port 8788] [--key <anahtar>]
//   klasör varsayılanı: <kullanıcı>/Downloads/Kiroku/Manga (Manga İndirici'nin kaydettiği yer)
//   Anime için örnek: node scripts/manga-library.mjs "D:/Anime" --port 8789

import { createServer } from "node:http";
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
      return createReadStream(target, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Length": info.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, cors).end();
  }
}).listen(port, () => {
  console.log(`Kütüphane: http://localhost:${port}  →  ${root}${key ? "  (erişim anahtarı gerekli)" : ""}`);
});
