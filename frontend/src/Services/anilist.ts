// AniList, Cloudflare Workers'ın çıkış IP'lerini engelliyor; bu yüzden AniList'e
// doğrudan tarayıcıdan gidilir (AniList CORS'a izin veriyor, eklenti de böyle çağırıyor).
// Worker yalnızca sonuçları DB'ye yazar.
import type { Relation } from "../lib/seriesTitle";

const ANILIST = "https://graphql.anilist.co";

export class AniListRateLimit extends Error {
  constructor(public retryAfter: number) {
    super("AniList istek sınırı aşıldı");
  }
}

export async function anilistQuery<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (res.status === 429) throw new AniListRateLimit(Number(res.headers.get("Retry-After")) || 60);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data) {
    throw new Error(`AniList hatası (${res.status}): ${JSON.stringify(json?.errors ?? json).slice(0, 200)}`);
  }
  return json.data as T;
}

type SearchMedia = {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  episodes: number | null;
  status: string | null;
  format: string | null;
  averageScore: number | null;
  genres: string[];
  coverImage: { extraLarge: string | null; large: string | null; medium: string | null } | null;
  siteUrl: string;
};

const SEARCH_QUERY = `
  query ($search: String, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage lastPage hasNextPage }
      media(search: $search, type: ANIME) {
        id idMal title { romaji english native } episodes status format averageScore genres
        coverImage { extraLarge large medium } siteUrl
      }
    }
  }`;

// Anime ekleme modalı Jikan biçiminde sonuç bekliyor; AniList yanıtı o biçime çevrilir
export async function searchAnime(search: string, page = 1) {
  const data = await anilistQuery<{
    Page: { pageInfo: { currentPage: number; lastPage: number; hasNextPage: boolean }; media: SearchMedia[] };
  }>(SEARCH_QUERY, { search, page, perPage: 10 });
  return {
    success: true,
    data: {
      pagination: { has_next_page: data.Page.pageInfo.hasNextPage, last_visible_page: data.Page.pageInfo.lastPage },
      data: data.Page.media.map((m) => ({
        mal_id: m.idMal ?? m.id,
        title: m.title.romaji ?? m.title.english ?? "",
        title_english: m.title.english ?? undefined,
        title_japanese: m.title.native ?? undefined,
        images: { jpg: { image_url: m.coverImage?.extraLarge ?? m.coverImage?.large ?? m.coverImage?.medium ?? "" } },
        type: m.format === "MOVIE" ? "Movie" : m.format ?? undefined,
        episodes: m.episodes ?? undefined,
        status: m.status ?? undefined,
        airing: m.status === "RELEASING",
        genres: m.genres.map((name) => ({ name })),
        score: m.averageScore ? m.averageScore / 10 : 0,
        url: m.idMal ? `https://myanimelist.net/anime/${m.idMal}` : m.siteUrl,
      })),
    },
  };
}

const SYNC_FIELDS = `id idMal title { romaji english } episodes status format averageScore genres coverImage { extraLarge large }
  relations { edges { relationType node { type title { romaji english } } } }`;

// Sync grubu: her anime adı tek GraphQL isteğinde alias'la aranır
export async function searchForSync(names: string[], signal?: AbortSignal): Promise<unknown[][]> {
  const vars = names.map((_, i) => `$s${i}: String`).join(", ");
  const parts = names.map((_, i) => `a${i}: Page(perPage: 5) { media(search: $s${i}, type: ANIME) { ${SYNC_FIELDS} } }`);
  const data = await anilistQuery<Record<string, { media: unknown[] }>>(
    `query (${vars}) { ${parts.join("\n")} }`,
    Object.fromEntries(names.map((n, i) => [`s${i}`, n])),
    signal
  );
  return names.map((_, i) => data[`a${i}`]?.media ?? []);
}

// Kapak yükseltme: MAL id'lerinden AniList'in en büyük kapağını (extraLarge) bulur
export async function coversByMalIds(ids: number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const data = await anilistQuery<{ Page: { media: { idMal: number | null; coverImage: { extraLarge: string | null } | null }[] } }>(
    `query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { idMal coverImage { extraLarge } } } }`,
    { ids },
    signal
  );
  const out = new Map<number, string>();
  for (const m of data.Page.media) {
    if (m.idMal && m.coverImage?.extraLarge) out.set(m.idMal, m.coverImage.extraLarge);
  }
  return out;
}

// İngilizce isim doldurma: MAL id'lerinden AniList title.english (yoksa null)
export async function englishTitlesByMalIds(ids: number[], signal?: AbortSignal): Promise<Map<number, string | null>> {
  const data = await anilistQuery<{ Page: { media: { idMal: number | null; title: { english: string | null } }[] } }>(
    `query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { idMal title { english } } } }`,
    { ids },
    signal
  );
  const out = new Map<number, string | null>();
  for (const m of data.Page.media) if (m.idMal) out.set(m.idMal, m.title.english);
  return out;
}

// Tek anime sync (#20): MAL id biliniyorsa birebir, yoksa adla aranır; sonuç /sync/batch'e force ile yollanır
export async function mediaForSingleSync(name: string, idMal: number | null, signal?: AbortSignal): Promise<unknown[]> {
  if (idMal) {
    const data = await anilistQuery<{ Media: unknown | null }>(
      `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { ${SYNC_FIELDS} } }`,
      { idMal },
      signal
    ).catch(() => ({ Media: null }));
    if (data.Media) return [data.Media];
  }
  return (await searchForSync([name], signal))[0];
}

// ---- Manga ----

export type AniListManga = {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  chapters: number | null;
  volumes: number | null;
  status: string | null;
  format: string | null;
  averageScore: number | null;
  genres: string[];
  coverImage: { extraLarge: string | null; large: string | null } | null;
  siteUrl: string;
  relations?: { edges: Relation[] } | null;
};

const MANGA_FIELDS = `id idMal title { romaji english native } chapters volumes status format averageScore genres
  coverImage { extraLarge large } siteUrl relations { edges { relationType node { type title { romaji english } } } }`;

export async function searchManga(search: string, signal?: AbortSignal): Promise<AniListManga[]> {
  const data = await anilistQuery<{ Page: { media: AniListManga[] } }>(
    `query ($search: String) { Page(perPage: 12) { media(search: $search, type: MANGA) { ${MANGA_FIELDS} } } }`,
    { search },
    signal
  );
  return data.Page.media;
}

/**
 * Manga sync: one GraphQL request per group. Each entry is looked up by AniList id, else MAL id
 * (idMal), else by name; the first match is returned (null when nothing is found).
 */
export async function mangaForSync(
  entries: { anilistId?: number; malId?: number; name: string }[],
  signal?: AbortSignal
): Promise<(AniListManga | null)[]> {
  const vars: string[] = [];
  const values: Record<string, unknown> = {};
  const parts = entries.map((e, i) => {
    if (e.anilistId) {
      vars.push(`$v${i}: Int`);
      values[`v${i}`] = e.anilistId;
      return `m${i}: Page(perPage: 1) { media(id: $v${i}, type: MANGA) { ${MANGA_FIELDS} } }`;
    }
    if (e.malId) {
      vars.push(`$v${i}: Int`);
      values[`v${i}`] = e.malId;
      return `m${i}: Page(perPage: 1) { media(idMal: $v${i}, type: MANGA) { ${MANGA_FIELDS} } }`;
    }
    vars.push(`$v${i}: String`);
    values[`v${i}`] = e.name;
    return `m${i}: Page(perPage: 1) { media(search: $v${i}, type: MANGA) { ${MANGA_FIELDS} } }`;
  });
  const data = await anilistQuery<Record<string, { media: AniListManga[] }>>(`query (${vars.join(", ")}) { ${parts.join("\n")} }`, values, signal);
  return entries.map((_, i) => data[`m${i}`]?.media?.[0] ?? null);
}
