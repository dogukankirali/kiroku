// The user's own anime video library for Salon (outside Kiroku): one folder per anime with its episode files
// ('<Anime>/<Anime> - 01.mkv') and optional sidecar subtitles with the same base name (.vtt or .srt).
//   http  — a file server with JSON folder listings (scripts/manga-library.mjs or Caddy `file_server browse`).
//           <video> cannot send an Authorization header, so an optional access key is added as ?key=… instead.
//   local — a folder picked with the File System Access API (kept for this tab only); files play from blob URLs.
// Settings and the anime → folder choices are stored per browser; nothing here is sent to the Kiroku Worker.

export type VideoLibraryConfig = { kind: "http" | "local"; url: string; key: string };
export type VideoEntry = { name: string; isDir: boolean };
export type Episode = { file: string; number: number; label: string; subtitle?: string };
/** An audio or subtitle stream inside a video file; `index` counts within its own kind (ffmpeg's 0:a:n / 0:s:n) */
export type MediaTrack = { index: number; lang: string; title: string; codec: string; default: boolean; forced: boolean; text?: boolean };
export type MediaTracks = { duration: number; audio: MediaTrack[]; subtitles: MediaTrack[] };

const KEY = "kirokuVideoLibrary";
const FOLDERS_KEY = "kirokuSalonFolders";
const DEFAULT: VideoLibraryConfig = { kind: "http", url: "", key: "" };

export const VIDEO_RE = /\.(mp4|m4v|webm|mkv|mov|ogv)$/i;
const SUB_RE = /\.(vtt|srt)$/i;

export function loadVideoLibrary(): VideoLibraryConfig {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT;
  }
}

export function saveVideoLibrary(cfg: VideoLibraryConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {}
}

export class VideoLibraryError extends Error {
  constructor(message: string, readonly kind: "config" | "pick" | "missing") {
    super(message);
  }
}

// ---- Local folder (File System Access API) ----

type DirHandle = FileSystemDirectoryHandle & { getDirectoryHandle(n: string): Promise<DirHandle> };
let localRoot: DirHandle | null = null;

export const canPickFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
export const localFolderName = () => localRoot?.name ?? "";
const useLocal = (cfg: VideoLibraryConfig) => cfg.kind === "local" || Boolean(localRoot);

export async function pickVideoFolder() {
  const picker = (window as unknown as { showDirectoryPicker: (o?: object) => Promise<DirHandle> }).showDirectoryPicker;
  localRoot = await picker({ id: "kiroku-anime", mode: "read" });
  return localRoot.name;
}

async function localFile(path: string): Promise<File> {
  if (!localRoot) throw new VideoLibraryError("Video klasörü seçilmedi", "pick");
  const parts = path.split("/");
  let dir = localRoot;
  try {
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    return await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  } catch {
    throw new VideoLibraryError(`Dosya seçilen klasörde bulunamadı: ${path}`, "missing");
  }
}

// ---- HTTP ----

function httpUrl(cfg: VideoLibraryConfig, path: string, dir = false, extra: Record<string, string | number> = {}) {
  const rel = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const base = `${cfg.url.replace(/\/+$/, "")}/${rel}${dir && rel ? "/" : ""}`;
  const query = new URLSearchParams();
  if (cfg.key) query.set("key", cfg.key);
  for (const [k, v] of Object.entries(extra)) query.set(k, String(v));
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

async function listHttp(cfg: VideoLibraryConfig, path: string): Promise<VideoEntry[]> {
  if (!cfg.url) throw new VideoLibraryError("Video kütüphanesi adresi ayarlanmadı", "config");
  let res: Response;
  try {
    res = await fetch(httpUrl(cfg, path, true), { headers: { Accept: "application/json" }, credentials: "omit" });
  } catch {
    throw new VideoLibraryError("Video kütüphanesine ulaşılamadı (sunucu kapalı ya da CORS ayarı)", "config");
  }
  if (res.status === 401 || res.status === 403) throw new VideoLibraryError("Video kütüphanesi erişim anahtarını reddetti", "config");
  if (res.status === 404) throw new VideoLibraryError(`Klasör bulunamadı: ${path || "/"}`, "missing");
  if (!res.ok) throw new VideoLibraryError(`Video kütüphanesi listelenemedi (${res.status})`, "config");
  const data = (await res.json().catch(() => null)) as { name?: string; is_dir?: boolean }[] | null;
  if (!Array.isArray(data)) throw new VideoLibraryError("Sunucu JSON klasör listesi döndürmedi", "config");
  return data
    .map((e) => ({ name: String(e.name ?? "").replace(/\/+$/, "").normalize("NFC"), isDir: Boolean(e.is_dir) }))
    .filter((e) => e.name && !e.name.startsWith("."));
}

async function listLocal(path: string): Promise<VideoEntry[]> {
  if (!localRoot) throw new VideoLibraryError("Video klasörü seçilmedi", "pick");
  let dir = localRoot;
  try {
    for (const p of path.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(p);
  } catch {
    throw new VideoLibraryError(`Klasör bulunamadı: ${path}`, "missing");
  }
  const out: VideoEntry[] = [];
  for await (const h of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (!h.name.startsWith(".")) out.push({ name: h.name.normalize("NFC"), isDir: h.kind === "directory" });
  }
  return out;
}

export function listVideoLibrary(path = ""): Promise<VideoEntry[]> {
  const cfg = loadVideoLibrary();
  return useLocal(cfg) ? listLocal(path) : listHttp(cfg, path);
}

/** A playable URL for a library file. Local files become blob URLs; call the returned revoke when done. */
export async function videoUrl(path: string): Promise<{ url: string; revoke: () => void }> {
  const cfg = loadVideoLibrary();
  if (!useLocal(cfg)) {
    if (!cfg.url) throw new VideoLibraryError("Video kütüphanesi adresi ayarlanmadı", "config");
    return { url: httpUrl(cfg, path), revoke: () => {} };
  }
  const url = URL.createObjectURL(await localFile(path));
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/** Subtitle track as a WebVTT blob URL (.srt is converted; browsers only play VTT) */
export async function subtitleUrl(path: string): Promise<{ url: string; revoke: () => void }> {
  const cfg = loadVideoLibrary();
  let text: string;
  if (useLocal(cfg)) text = await (await localFile(path)).text();
  else {
    const res = await fetch(httpUrl(cfg, path), { credentials: "omit" });
    if (!res.ok) throw new VideoLibraryError(`Altyazı açılamadı (${res.status})`, "missing");
    text = await res.text();
  }
  const vtt = /\.srt$/i.test(path) ? srtToVtt(text) : text;
  const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

// ---- Tracks inside the video file (needs scripts/manga-library.mjs with ffmpeg; local folders and plain file servers have none) ----

/** Audio and subtitle streams of a file, or null when the server cannot list them */
export async function fetchTracks(path: string): Promise<MediaTracks | null> {
  const cfg = loadVideoLibrary();
  if (useLocal(cfg) || !cfg.url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(httpUrl(cfg, path, false, { tracks: 1 }), { credentials: "omit", signal: ctrl.signal });
    // A server without ffmpeg ignores ?tracks and would stream the whole video: only read JSON answers
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
      ctrl.abort();
      return null;
    }
    const data = (await res.json()) as Partial<MediaTracks> | null;
    return data && Array.isArray(data.audio) && Array.isArray(data.subtitles) ? { duration: Number(data.duration) || 0, audio: data.audio, subtitles: data.subtitles } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Subtitle search and download (library server with --writable; it talks to the subtitle providers, keys stay on the server) ----

export type SubtitleHit = { id: string; name: string; lang: string; downloads: number; provider: string };
export type SubtitleInfo = { writable: boolean; providers: string[] };

async function subsJson<T>(path: string, extra: Record<string, string | number>, init?: RequestInit): Promise<T> {
  const cfg = loadVideoLibrary();
  const res = await fetch(httpUrl(cfg, path, false, extra), { credentials: "omit", ...init });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new VideoLibraryError(data?.error ?? `Altyazı sunucusu ${res.status} döndürdü`, "config");
  return data;
}

/** What the library server can do about subtitles, or null when it has no such feature (older server, Caddy, local folder) */
export async function subtitleInfo(): Promise<SubtitleInfo | null> {
  const cfg = loadVideoLibrary();
  if (useLocal(cfg) || !cfg.url) return null;
  try {
    const res = await fetch(httpUrl(cfg, "__subs/providers"), { credentials: "omit" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const data = (await res.json()) as Partial<SubtitleInfo>;
    return Array.isArray(data.providers) ? { writable: Boolean(data.writable), providers: data.providers } : null;
  } catch {
    return null;
  }
}

export function searchSubtitles(p: { provider: string; q: string; lang: string; season?: string; episode?: string }): Promise<SubtitleHit[]> {
  const extra: Record<string, string> = { provider: p.provider, q: p.q, lang: p.lang };
  if (p.season) extra.season = p.season;
  if (p.episode) extra.episode = p.episode;
  return subsJson<SubtitleHit[]>("__subs/search", extra);
}

/** Downloads a subtitle next to the video file on the server; returns the saved file name */
export async function saveSubtitleFile(p: { provider: string; id: string; lang: string; file: string }): Promise<string> {
  return (await subsJson<{ saved: string }>("__subs/save", { provider: p.provider, id: p.id, lang: p.lang, file: p.file }, { method: "POST" })).saved;
}

/** MP4 stream of the file with one chosen audio track, starting at `start` seconds (video is copied, audio becomes AAC) */
export function audioStreamUrl(path: string, audioIndex: number, start: number, compat = false) {
  return httpUrl(loadVideoLibrary(), path, false, { audio: audioIndex, start: Math.max(0, start), ...(compat ? { compat: 1 } : {}) });
}

/** Where a stream asked to start at `t` really starts: the closest keyframe before it, so subtitles stay in sync */
export async function keyframeBefore(path: string, t: number): Promise<number> {
  if (t <= 0) return 0;
  try {
    const res = await fetch(httpUrl(loadVideoLibrary(), path, false, { keyframe: t }), { credentials: "omit" });
    const data = (await res.json()) as { start?: number };
    return res.ok && Number.isFinite(data.start) ? Number(data.start) : t;
  } catch {
    return t;
  }
}

/** An embedded text subtitle track as WebVTT text */
export async function embeddedSubtitleText(path: string, subIndex: number): Promise<string> {
  const res = await fetch(httpUrl(loadVideoLibrary(), path, false, { sub: subIndex }), { credentials: "omit" });
  if (!res.ok) throw new VideoLibraryError(`Altyazı açılamadı (${res.status})`, "missing");
  return res.text();
}

/** WebVTT text with every cue moved `seconds` earlier (cues that end before 0 are dropped): subtitles for a stream that starts mid-file */
export function shiftVtt(vtt: string, seconds: number): string {
  if (!seconds) return vtt;
  const parse = (t: string) => {
    const parts = t.split(":").map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  };
  const fmt = (t: number) => {
    const ms = Math.round(Math.max(0, t) * 1000);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
  };
  const stamp = /^((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{3})(.*)$/;
  const blocks = vtt.replace(/\r/g, "").split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => stamp.test(l));
    if (at < 0) {
      out.push(block);
      continue;
    }
    const m = stamp.exec(lines[at])!;
    const end = parse(m[2]) - seconds;
    if (end <= 0) continue;
    lines[at] = `${fmt(parse(m[1]) - seconds)} --> ${fmt(end)}${m[3]}`;
    out.push(lines.join("\n"));
  }
  return out.join("\n\n");
}

export function srtToVtt(srt: string) {
  return "WEBVTT\n\n" + srt.replace(/^﻿/, "").replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

// ---- Episodes and folder matching ----

/** Episode number from a file name: 'Show - 01.mkv', 'Show S2E05.mp4', 'Episode 12.webm', '[Group] Show 07 [1080p].mkv' */
export function parseEpisodeFile(fileName: string): number {
  const base = fileName
    .replace(VIDEO_RE, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(?:480|540|720|1080|2160)p\b|\bx26[45]\b|\bh\.?26[45]\b|\b10.?bit\b/gi, " ");
  const m =
    /(?:\bs\d{1,2}\s*)?e(?:p(?:isode)?)?\.?\s*(\d{1,4}(?:\.\d)?)\b/i.exec(base) ??
    /(?:b[öo]l[üu]m)\s*(\d{1,4})/i.exec(base) ??
    /\s-\s*(\d{1,4}(?:\.\d)?)\b/.exec(base) ??
    /(\d{1,4}(?:\.\d)?)(?!.*\d)/.exec(base);
  return m ? Number(m[1]) : 0;
}

/** Video files of a folder sorted by episode, each with its sidecar subtitle when present */
export async function listEpisodes(folder: string): Promise<Episode[]> {
  const entries = (await listVideoLibrary(folder)).filter((e) => !e.isDir);
  const subs = entries.filter((e) => SUB_RE.test(e.name));
  const stem = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();
  return entries
    .filter((e) => VIDEO_RE.test(e.name))
    .map((e) => {
      // Aynı bölümün birden çok altyazısı olabilir ('Ad.tr.srt', 'Ad.en.srt'): Türkçe olan öne alınır
      const matching = subs.filter((s) => stem(s.name) === stem(e.name) || stem(s.name).startsWith(`${stem(e.name)}.`));
      const sub = matching.find((s) => /\.(tr|tur|turkce|turkish)\.[^.]+$/i.test(s.name)) ?? matching[0];
      const number = parseEpisodeFile(e.name);
      return { file: `${folder}/${e.name}`, number, label: number ? `${number}. bölüm` : e.name, subtitle: sub ? `${folder}/${sub.name}` : undefined };
    })
    .sort((a, b) => a.number - b.number || a.file.localeCompare(b.file, "tr", { numeric: true }));
}

export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The library folder that belongs to an anime: the one chosen earlier in this browser, else a name match */
export function matchFolder(animeId: number, names: string[], folders: string[]): string | null {
  const saved = savedFolder(animeId);
  // Kayıtlı yol iç içe olabilir ('Seri/Sezon 1'); ilk parçası kütüphanede durduğu sürece geçerli
  if (saved && folders.includes(saved.split("/")[0])) return saved;
  const wanted = names.filter(Boolean).map(norm);
  return folders.find((f) => wanted.includes(norm(f))) ?? null;
}

export function savedFolder(animeId: number): string | null {
  try {
    return (JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "{}") as Record<string, string>)[animeId] ?? null;
  } catch {
    return null;
  }
}

export function saveFolder(animeId: number, folder: string | null) {
  try {
    const map = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "{}") as Record<string, string>;
    if (folder) map[animeId] = folder;
    else delete map[animeId];
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(map));
  } catch {}
}
