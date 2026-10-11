// Seri adı: AniList ilişkilerinden (worker/src/anilist.ts ile aynı kural). Sezon/cilt eki atılır ki
// ana hikaye ile devamları aynı seride buluşsun.

export type Relation = { relationType: string; node: { type: string; title: { romaji: string | null; english: string | null } } };

export function seriesBaseTitle(title: string): string {
  // Yalnızca ": " ile ayrılan alt başlık atılır ("Re:Zero" gibi adlar bozulmasın)
  let t = title.split(/:\s/)[0].trim();
  const SUFFIX =
    /\s+(?:\(?\d+(?:st|nd|rd|th)\s+(?:season|cour)\)?|season\s*\d+|(?:part|cour)\s*\d+|(?:the\s+)?final\s+season|2nd|3rd|\d+th|ii|iii|iv|v|vi|\d)$/i;
  for (let i = 0; i < 3 && SUFFIX.test(t); i++) t = t.replace(SUFFIX, "").trim();
  return t;
}

/** type: aynı türden ilişkiler dikkate alınır (mangada MANGA, animede ANIME) */
export function seriesNameFrom(ownTitle: string, edges: Relation[] | undefined, type: "ANIME" | "MANGA"): string {
  const same = (edges ?? []).filter((e) => e.node.type === type);
  const title = (e: Relation) => (e.node.title.romaji ?? e.node.title.english ?? "").trim();
  const find = (rel: string) => same.find((e) => e.relationType === rel);
  const parent = find("PARENT");
  if (parent) return seriesBaseTitle(title(parent));
  const prequel = find("PREQUEL");
  if (prequel) return seriesBaseTitle(title(prequel));
  if (find("SEQUEL")) return seriesBaseTitle(ownTitle);
  return "";
}
