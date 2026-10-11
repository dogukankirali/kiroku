import axios from "axios";
import { API_BASE } from "./http";
import type { AniListManga } from "./anilist";
import { seriesNameFrom } from "../lib/seriesTitle";

export type ReadStatus = "" | "READING" | "COMPLETED" | "PAUSED" | "DROPPED" | "PLANNING";

export interface Manga {
  id: number;
  name: string;
  englishName: string;
  status: string;
  format: string;
  totalChapters: number;
  totalVolumes: number;
  malScore: number;
  genres: string[];
  cover: string;
  anilistId: number;
  malId: number;
  malLink: string;
  anilistLink: string;
  syncedAt: string;
  mangadexId: string;
  seriesName: string;
  score: number;
  readStatus: ReadStatus;
  chaptersRead: number;
  volumesRead: number;
  planToRead: boolean;
  notes: string;
  startedAt: string;
  finishedAt: string;
  inMyList: boolean;
}

export type MangaInput = Partial<Omit<Manga, "id" | "syncedAt" | "inMyList" | "mangadexId">>;

export interface MangaQuery {
  q?: string;
  status?: string;
  format?: string;
  readStatus?: string;
  genres?: string[];
  ptr?: boolean;
  mine?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  count?: number;
}

export interface MangaPage {
  data: Manga[];
  pagination: { page: number; count: number; total: number; pages: number };
}

export interface ReadlistItem {
  id: number;
  orderRank: number;
  manga: Manga;
}

const base = `${API_BASE}/manga`;

export const MangaService = {
  async list(q: MangaQuery): Promise<MangaPage> {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.status) p.set("status", q.status);
    if (q.format) p.set("format", q.format);
    if (q.readStatus) p.set("read-status", q.readStatus);
    for (const g of q.genres ?? []) p.append("genre", g);
    if (q.ptr) p.set("ptr", "1");
    if (q.mine) p.set("mine", "1");
    if (q.sort) p.set("sort", q.sort);
    if (q.order) p.set("order", q.order);
    p.set("page", String(q.page ?? 1));
    p.set("count", String(q.count ?? 48));
    return (await axios.get<MangaPage>(`${base}?${p}`)).data;
  },
  async get(id: number): Promise<Manga> {
    return (await axios.get<Manga>(`${base}/${id}`)).data;
  },
  async genres(): Promise<string[]> {
    return (await axios.get<string[]>(`${base}/genres`)).data;
  },
  async create(data: MangaInput): Promise<Manga> {
    return (await axios.post<Manga>(base, data)).data;
  },
  async update(id: number, data: MangaInput): Promise<Manga> {
    return (await axios.put<Manga>(`${base}/${id}`, data)).data;
  },
  async removeFromMine(id: number) {
    await axios.delete(`${base}/${id}/mine`);
  },
  async remove(id: number) {
    await axios.delete(`${base}/${id}`);
  },
  /** Marks chapters up to `chaptersRead` as read (never lowers progress) */
  async saveProgress(id: number, chaptersRead: number): Promise<Manga> {
    return (await axios.put<Manga>(`${base}/${id}/progress`, { chaptersRead })).data;
  },
  async syncBatch(items: (MangaInput & { id: number })[]): Promise<{ updated: number }> {
    return (await axios.post(`${base}/sync-batch`, { items })).data;
  },
  readlist: {
    async list(): Promise<ReadlistItem[]> {
      return (await axios.get<ReadlistItem[]>(`${API_BASE}/readlist`)).data;
    },
    async add(mangaId: number) {
      await axios.post(`${API_BASE}/readlist`, { mangaId });
    },
    async reorder(items: { id: number; orderRank: number }[]) {
      await axios.put(`${API_BASE}/readlist/order`, items);
    },
    async remove(id: number) {
      await axios.delete(`${API_BASE}/readlist/${id}`);
    },
  },
};

/** AniList manga → catalog fields (MAL score from AniList average, MAL link from idMal) */
export function fromAniList(m: AniListManga): MangaInput {
  return {
    name: m.title.romaji ?? m.title.english ?? "",
    englishName: m.title.english ?? "",
    status: m.status ?? "",
    format: m.format ?? "",
    totalChapters: m.chapters ?? 0,
    totalVolumes: m.volumes ?? 0,
    malScore: m.averageScore ? m.averageScore / 10 : 0,
    genres: m.genres ?? [],
    cover: m.coverImage?.extraLarge ?? m.coverImage?.large ?? "",
    anilistId: m.id,
    malId: m.idMal ?? 0,
    malLink: m.idMal ? `https://myanimelist.net/manga/${m.idMal}` : "",
    anilistLink: m.siteUrl,
    seriesName: seriesNameFrom(m.title.romaji ?? m.title.english ?? "", m.relations?.edges, "MANGA"),
  };
}

export const errorText = (e: unknown) =>
  (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message ??
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  (e as Error)?.message ??
  "Bilinmeyen hata";

export interface Chapter {
  id: number;
  mangaId: number;
  number: number;
  volume: string;
  title: string;
  /** "mangadex" (live), "upload" (CBZ) or a source adapter's slug */
  source: string;
  externalId: string;
  pageCount: number;
  /** Library chapters: CBZ path relative to the user's library root ('<Series>/<Chapter N - Title>.cbz'); "" for live MangaDex chapters */
  filePath: string;
  lang: string;
  groupName: string;
  publishedAt: string;
  createdAt: string;
}

export type MangaDexChapterInput = Pick<Chapter, "externalId" | "number" | "volume" | "title" | "pageCount" | "lang" | "groupName" | "publishedAt">;

export interface LibraryChapterInput {
  filePath: string;
  number: number;
  volume?: string;
  title?: string;
  lang: string;
  pageCount?: number;
  /** "upload" for manual entries, or a source adapter's slug */
  source?: string;
  externalId?: string;
  scanlator?: string;
}

export interface LibrarySyncResult {
  mangaId: number;
  mangaName: string;
  created: boolean;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

export const ChapterService = {
  async list(mangaId: number): Promise<Chapter[]> {
    return (await axios.get<Chapter[]>(`${base}/${mangaId}/chapters`)).data;
  },
  async get(id: number): Promise<Chapter> {
    return (await axios.get<Chapter>(`${base}/chapters/${id}`)).data;
  },
  async linkMangaDex(mangaId: number, mangadexId: string) {
    await axios.put(`${base}/${mangaId}/mangadex`, { mangadexId });
  },
  async saveMangaDex(mangaId: number, chapters: MangaDexChapterInput[]): Promise<{ saved: number }> {
    return (await axios.post(`${base}/${mangaId}/chapters/mangadex`, { chapters })).data;
  },
  /** Library sync for one series folder (see worker chapters.ts /manga/library-sync) */
  async librarySync(data: { series: string; anilistId?: number; malId?: number; name?: string; chapters: { filePath: string; number: number; title: string }[]; prune?: boolean }): Promise<LibrarySyncResult> {
    return (await axios.post<LibrarySyncResult>(`${base}/library-sync`, data)).data;
  },
  /** Registers a CBZ in the user's own library (metadata only; the file never goes to Kiroku) */
  async register(mangaId: number, data: LibraryChapterInput): Promise<Chapter> {
    return (await axios.post<Chapter>(`${base}/${mangaId}/chapters`, data)).data;
  },
  async remove(chapterId: number) {
    await axios.delete(`${base}/chapters/${chapterId}`);
  },
};
