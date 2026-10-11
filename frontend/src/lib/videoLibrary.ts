// The user's own anime video library for Salon (outside Kiroku): one folder per anime with its episode files
// ('<Anime>/<Anime> - 01.mkv') and optional sidecar subtitles with the same base name (.vtt or .srt).
//   http  — a file server with JSON folder listings (scripts/manga-library.mjs or Caddy `file_server browse`).
//           <video> cannot send an Authorization header, so an optional access key is added as ?key=… instead.
//   local — a folder picked with the File System Access API (kept for this tab only); files play from blob URLs.
// Settings and the anime → folder choices are stored per browser; nothing here is sent to the Kiroku Worker.

export type VideoLibraryConfig = { kind: "http" | "local"; url: string; key: string };
export type VideoEntry = { name: string; isDir: boolean };
export type Episode = { file: string; number: number; label: string; subtitle?: string };

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

function httpUrl(cfg: VideoLibraryConfig, path: string, dir = false) {
  const rel = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const base = `${cfg.url.replace(/\/+$/, "")}/${rel}${dir && rel ? "/" : ""}`;
  return cfg.key ? `${base}?key=${encodeURIComponent(cfg.key)}` : base;
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
      const sub = subs.find((s) => stem(s.name) === stem(e.name) || stem(s.name).startsWith(`${stem(e.name)}.`));
      const number = parseEpisodeFile(e.name);
      return { file: `${folder}/${e.name}`, number, label: number ? `${number}. bölüm` : e.name, subtitle: sub ? `${folder}/${sub.name}` : undefined };
    })
    .sort((a, b) => a.number - b.number || a.file.localeCompare(b.file, "tr", { numeric: true }));
}

const norm = (s: string) =>
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
  if (saved && folders.includes(saved)) return saved;
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
