import axios from "axios";
import { API_BASE } from "./http";

// Kitaplığım (/api/library): fiziksel kitap ve mangaların seri/cilt takibi

export type ShelfKind = "manga" | "book";

export interface ShelfSeries {
  id: number;
  kind: ShelfKind;
  title: string;
  mangaId: number | null;
  bookId: number | null;
  totalVolumes: number;
  cover: string;
  notes: string;
  ownedCount: number;
  wantedCount: number;
  maxVolume: number;
}

export interface ShelfVolume {
  id: number;
  seriesId: number;
  number: number;
  edition: string;
  owned: boolean;
  wanted: boolean;
  isbn: string;
  title: string;
  publisher: string;
  language: string;
  condition: string;
  location: string;
  cover: string;
  notes: string;
}

export type ShelfSeriesDetail = ShelfSeries & { volumes: ShelfVolume[] };
export type ShelfSeriesInput = Partial<Pick<ShelfSeries, "kind" | "title" | "totalVolumes" | "cover" | "notes">>;

const base = `${API_BASE}/library`;

/** "1-12, 14" → [1..12, 14]; tanınmayan parçalar atılır */
export function parseVolumeRange(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a > 500) continue;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

export const LibraryService = {
  async list(params: { kind?: ShelfKind; q?: string } = {}): Promise<ShelfSeries[]> {
    return (await axios.get<ShelfSeries[]>(`${base}/series`, { params })).data;
  },
  async get(id: number): Promise<ShelfSeriesDetail> {
    return (await axios.get<ShelfSeriesDetail>(`${base}/series/${id}`)).data;
  },
  async create(data: ShelfSeriesInput): Promise<ShelfSeriesDetail> {
    return (await axios.post<ShelfSeriesDetail>(`${base}/series`, data)).data;
  },
  async update(id: number, data: ShelfSeriesInput): Promise<ShelfSeriesDetail> {
    return (await axios.put<ShelfSeriesDetail>(`${base}/series/${id}`, data)).data;
  },
  async remove(id: number) {
    await axios.delete(`${base}/series/${id}`);
  },
  /** Ciltleri toplu ekler/günceller: owned (varsayılan) ya da istek listesi (wanted) */
  async setVolumes(id: number, numbers: number[], state: "owned" | "wanted"): Promise<ShelfSeriesDetail> {
    return (await axios.post<ShelfSeriesDetail>(`${base}/series/${id}/volumes`, { numbers, owned: state === "owned", wanted: state === "wanted" })).data;
  },
  async updateVolume(id: number, data: Partial<ShelfVolume>): Promise<ShelfVolume> {
    return (await axios.put<ShelfVolume>(`${base}/volumes/${id}`, data)).data;
  },
  async removeVolume(id: number) {
    await axios.delete(`${base}/volumes/${id}`);
  },
};

export const errorText = (err: unknown, fallback = "İşlem başarısız") =>
  (axios.isAxiosError(err) && (err.response?.data as { message?: string } | undefined)?.message) || fallback;
