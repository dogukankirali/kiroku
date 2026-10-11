"use client";

// Anime detay sayfası (/anime/detail?id=…): Kiroku kaydı (puan, ilerleme, notlar) + AniList'ten ayrıntılar
// (açıklama, stüdyo, yayın tarihleri, karakterler, ilişkili animeler, öneriler, fragman, bağlantılar).

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, Box, Button, Chip, LinearProgress, Skeleton, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import BookmarkRoundedIcon from "@mui/icons-material/BookmarkRounded";
import LiveTvRoundedIcon from "@mui/icons-material/LiveTvRounded";
import { AnimeService } from "../../../Services/AnimeServices";
import { palette } from "../../../theme/customTheme";
import { formatWatchDate } from "../../../components/anime/WatchDates";
import { listVideoLibrary, loadVideoLibrary, matchFolder } from "../../../lib/videoLibrary";
import {
  FORMAT_TR,
  MediaDetail,
  RELATION_TR,
  RelatedMedia,
  SEASON_TR,
  SOURCE_TR,
  STATUS_TR,
  fetchMediaDetail,
  formatFuzzy,
  plainDescription,
} from "../../../lib/anilistDetail";

const card = {
  p: { xs: 2, md: 2.5 },
  borderRadius: "16px",
  backgroundColor: palette.surface,
  border: `1px solid ${alpha(palette.overlay, 0.06)}`,
};

const malIdOf = (link?: string) => Number(/myanimelist\.net\/anime\/(\d+)/.exec(link ?? "")?.[1]) || null;
const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function Section({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <Box sx={card}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1rem", flex: 1 }}>{title}</Typography>
        {extra}
      </Box>
      {children}
    </Box>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.75, borderBottom: `1px solid ${alpha(palette.overlay, 0.05)}` }}>
      <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>{label}</Typography>
      <Typography sx={{ fontSize: "0.85rem", fontWeight: 600, textAlign: "right" }}>{value}</Typography>
    </Box>
  );
}

function Stat({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 92 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "1.35rem", fontWeight: 800 }}>
        {icon}
        {value}
      </Box>
      <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>{label}</Typography>
    </Box>
  );
}

/** İlişkili/önerilen anime kartı: Kiroku arşivindeyse kendi detay sayfasına, değilse AniList'e gider */
function MediaCard({ m, caption, localId }: { m: RelatedMedia; caption?: string; localId?: number }) {
  const title = m.title.romaji || m.title.english || `#${m.id}`;
  const inner = (
    <>
      <Box sx={{ position: "relative", aspectRatio: "2/3", borderRadius: "10px", overflow: "hidden", backgroundColor: palette.surfaceRaised }}>
        {m.coverImage?.large && <img src={m.coverImage.large} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        {localId && (
          <Chip
            size="small"
            label="Arşivde"
            sx={{ position: "absolute", top: 6, left: 6, height: 20, fontSize: "0.65rem", fontWeight: 700, backgroundColor: palette.primary, color: palette.onPrimary }}
          />
        )}
      </Box>
      {caption && <Typography sx={{ fontSize: "0.68rem", color: palette.primary, fontWeight: 700, mt: 0.75 }}>{caption}</Typography>}
      <Typography sx={{ fontSize: "0.8rem", fontWeight: 600, lineHeight: 1.3, mt: caption ? 0.25 : 0.75, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {title}
      </Typography>
      <Typography sx={{ fontSize: "0.7rem", color: palette.textMuted }}>{[FORMAT_TR[m.format ?? ""] ?? m.format, m.averageScore ? `${m.averageScore}%` : null].filter(Boolean).join(" · ")}</Typography>
    </>
  );
  const sx = { textDecoration: "none", color: "inherit", display: "block", "&:hover img": { transform: "scale(1.04)" }, "& img": { transition: "transform .25s" } };
  return localId ? (
    <Box component={Link} href={`/anime/detail?id=${localId}`} sx={sx}>
      {inner}
    </Box>
  ) : (
    <Box component="a" href={`https://anilist.co/anime/${m.id}`} target="_blank" rel="noopener noreferrer" sx={sx}>
      {inner}
    </Box>
  );
}

const cardGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 1.5 };

function DetailContent() {
  const id = Number(useSearchParams().get("id"));
  const [anime, setAnime] = useState<TEATable.IAnime | null>(null);
  const [media, setMedia] = useState<MediaDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<TEATable.IAnime[]>([]);
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Salon: "match" kütüphanede bu animenin klasörü var, "pick" kütüphane var ama klasör eşleşmedi, "setup" ayarlanmadı
  const [salon, setSalon] = useState<"match" | "pick" | "setup" | null>(null);

  useEffect(() => {
    if (!id) return setError("Geçersiz anime");
    const ctrl = new AbortController();
    setAnime(null);
    setMedia(undefined);
    setError(null);
    setExpanded(false);
    (async () => {
      try {
        const res = await AnimeService.getAnime(id);
        const a: TEATable.IAnime = res.data.data;
        setAnime(a);
        const m = await fetchMediaDetail({ anilistId: a.AnilistID, malId: malIdOf(a.MALAnimeLink), name: a.Name }, ctrl.signal);
        setMedia(m);
      } catch (err: any) {
        if (ctrl.signal.aborted) return;
        if (err?.response?.status === 404) setError("Anime bulunamadı");
        else setMedia((prev) => (prev === undefined ? null : prev));
      }
    })();
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => {
    if (!anime) return;
    let alive = true;
    setSalon(null);
    const cfg = loadVideoLibrary();
    if (cfg.kind === "local") return setSalon("pick");
    if (!cfg.url) return setSalon("setup");
    listVideoLibrary("")
      .then((entries) => {
        const dirs = entries.filter((e) => e.isDir).map((e) => e.name);
        if (alive) setSalon(matchFolder(anime.ID, [String(anime.Name), String(anime.EnglishName ?? "")], dirs) ? "match" : "pick");
      })
      .catch(() => alive && setSalon(null));
    return () => {
      alive = false;
    };
  }, [anime]);

  // İlişkili/önerilen animelerin arşivde olup olmadığını bulmak için katalog
  useEffect(() => {
    AnimeService.getAnimes({ page: 1, count: 100000, filters: [], orderBy: "Name", order: "asc" })
      .then((res: any) => setCatalog(res?.data ?? []))
      .catch(() => {});
  }, []);

  const localIdOf = useMemo(() => {
    const byMal = new Map<number, number>();
    const byAni = new Map<number, number>();
    const byName = new Map<string, number>();
    for (const a of catalog) {
      const mal = malIdOf(a.MALAnimeLink);
      if (mal) byMal.set(mal, a.ID);
      if (a.AnilistID) byAni.set(a.AnilistID, a.ID);
      byName.set(norm(String(a.Name)), a.ID);
    }
    return (m: RelatedMedia) =>
      byAni.get(m.id) ?? (m.idMal ? byMal.get(m.idMal) : undefined) ?? byName.get(norm(m.title.romaji ?? "")) ?? byName.get(norm(m.title.english ?? ""));
  }, [catalog]);

  if (error) {
    return (
      <Box sx={{ maxWidth: 1100, mx: "auto" }}>
        <Alert severity="error" sx={{ borderRadius: "12px" }}>
          {error}
        </Alert>
      </Box>
    );
  }

  const cover = media?.coverImage?.extraLarge || anime?.Cover || media?.coverImage?.large || "";
  const description = plainDescription(media?.description ?? null);
  const relations = (media?.relations.edges ?? []).filter((e) => e.node.type === "ANIME");
  const recs = (media?.recommendations.nodes ?? []).map((n) => n.mediaRecommendation).filter((m): m is RelatedMedia => Boolean(m));
  const tags = (media?.tags ?? []).filter((t) => showSpoilers || !t.isMediaSpoiler).slice(0, 18);
  const spoilerCount = (media?.tags ?? []).filter((t) => t.isMediaSpoiler).length;
  const rankings = (media?.rankings ?? []).filter((r) => r.allTime || r.year).slice(0, 4);
  const total = anime?.TotalNumberOfEpisodes || media?.episodes || 0;
  const watched = anime?.WatchStatus ?? 0;
  const malId = media?.idMal ?? malIdOf(anime?.MALAnimeLink);
  const accent = media?.coverImage?.color ?? palette.primary;

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", display: "grid", gap: 2.5 }}>
      <Box>
        <Button component={Link} href="/anime" startIcon={<ArrowBackRoundedIcon />} sx={{ color: palette.textMuted }}>
          Anime arşivi
        </Button>
      </Box>

      {/* Üst bölüm: banner + kapak + başlık */}
      <Box sx={{ ...card, p: 0, overflow: "hidden" }}>
        <Box
          sx={{
            height: { xs: 120, md: 220 },
            backgroundColor: alpha(accent, 0.25),
            backgroundImage: media?.bannerImage ? `url(${media.bannerImage})` : `linear-gradient(120deg, ${alpha(accent, 0.45)}, transparent)`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            position: "relative",
            "&::after": { content: '""', position: "absolute", inset: 0, background: `linear-gradient(to bottom, transparent 30%, ${palette.surface})` },
          }}
        />
        <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: { xs: 2, md: 3 }, px: { xs: 2, md: 3 }, pb: { xs: 2, md: 3 }, mt: { xs: -8, md: -12 }, position: "relative" }}>
          <Box sx={{ width: { xs: 130, md: 200 }, flexShrink: 0, aspectRatio: "2/3", borderRadius: "12px", overflow: "hidden", backgroundColor: palette.surfaceRaised, boxShadow: "0 18px 40px rgba(0,0,0,0.45)" }}>
            {cover ? <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, pt: { sm: 13, md: 14 } }}>
            {anime ? (
              <>
                <Typography variant="h4" sx={{ fontSize: { xs: "1.5rem", md: "2rem" }, lineHeight: 1.15 }}>
                  {anime.Name}
                </Typography>
                <Typography sx={{ color: palette.textMuted, mt: 0.5 }}>
                  {[media?.title.english && media.title.english !== anime.Name ? media.title.english : anime.EnglishName, media?.title.native].filter(Boolean).join(" · ")}
                </Typography>
              </>
            ) : (
              <Skeleton width="60%" height={48} />
            )}
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1.5 }}>
              {(media?.genres ?? (anime?.Genre ? String(anime.Genre).split(/,\s*/) : [])).map((g) => (
                <Chip key={g} label={g} size="small" sx={{ backgroundColor: alpha(palette.primary, 0.12), color: palette.primary, fontWeight: 600 }} />
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: { xs: 2, md: 3.5 }, flexWrap: "wrap", mt: 2.5 }}>
              {Number(anime?.Score) > 0 ? <Stat label="Senin puanın" value={anime!.Score} icon={<StarRoundedIcon sx={{ color: palette.warning }} />} /> : null}
              {media?.averageScore ? <Stat label="AniList" value={`${media.averageScore}%`} /> : null}
              {anime?.MALScore ? <Stat label="MyAnimeList" value={Number(anime.MALScore).toFixed(2)} /> : null}
              {media?.popularity ? <Stat label="Popülerlik" value={media.popularity.toLocaleString("tr")} /> : null}
              {media?.favourites ? <Stat label="Favori" value={media.favourites.toLocaleString("tr")} icon={<FavoriteRoundedIcon sx={{ color: palette.danger, fontSize: 20 }} />} /> : null}
            </Box>
            {anime && salon ? (
              <Box sx={{ mt: 2.5 }}>
                {salon === "match" ? (
                  <Button variant="contained" component={Link} href={`/salon?id=${anime.ID}`} startIcon={<LiveTvRoundedIcon />}>
                    Salon&apos;da izle
                  </Button>
                ) : (
                  <Button size="small" component={Link} href={`/salon?id=${anime.ID}`} startIcon={<LiveTvRoundedIcon />} sx={{ color: palette.textMuted }}>
                    {salon === "setup" ? "Salon'u ayarla" : "Salon'da klasör seç"}
                  </Button>
                )}
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>

      {media === undefined && <LinearProgress sx={{ borderRadius: 2 }} />}
      {media === null && (
        <Alert severity="info" sx={{ borderRadius: "12px" }}>
          Bu anime AniList&apos;te bulunamadı ya da AniList&apos;e şu an ulaşılamıyor; yalnızca arşivdeki bilgiler gösteriliyor.
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "320px minmax(0, 1fr)" }, gap: 2.5, alignItems: "start" }}>
        {/* Sol sütun */}
        <Box sx={{ display: "grid", gap: 2.5 }}>
          {anime && (
            <Section title="Senin kaydın">
              <Box sx={{ mb: 1.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>İlerleme</Typography>
                  <Typography sx={{ fontSize: "0.85rem", fontWeight: 700 }}>
                    {watched}/{total || "?"}
                  </Typography>
                </Box>
                <LinearProgress variant="determinate" value={total ? Math.min(100, (Number(watched) / Number(total)) * 100) : 0} sx={{ height: 6, borderRadius: 3 }} />
              </Box>
              <InfoRow
                label="Puan"
                value={Number(anime.Score) > 0 ? anime.Score : <Box component="span" sx={{ color: palette.textMuted, fontWeight: 500 }}>Puanlanmadı</Box>}
              />
              <InfoRow
                label="Watchlist"
                value={
                  anime.PlanToWatch ? (
                    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: palette.primary }}>
                      <BookmarkRoundedIcon sx={{ fontSize: 16 }} /> Listede
                    </Box>
                  ) : (
                    "Hayır"
                  )
                }
              />
              <InfoRow label="Başladım" value={formatWatchDate(anime.StartedAt)} />
              <InfoRow label="Bitirdim" value={formatWatchDate(anime.FinishedAt)} />
              {anime.Notes && <Typography sx={{ fontSize: "0.82rem", color: palette.textMuted, whiteSpace: "pre-wrap", mt: 1.25 }}>{anime.Notes}</Typography>}
            </Section>
          )}

          {media && (
            <Section title="Bilgiler">
              <InfoRow label="Format" value={FORMAT_TR[media.format ?? ""] ?? media.format} />
              <InfoRow label="Durum" value={STATUS_TR[media.status ?? ""] ?? media.status} />
              <InfoRow label="Bölüm" value={media.episodes ?? (media.nextAiringEpisode ? `${media.nextAiringEpisode.episode - 1}+` : null)} />
              <InfoRow label="Bölüm süresi" value={media.duration ? `${media.duration} dk` : null} />
              <InfoRow
                label="Sıradaki bölüm"
                value={
                  media.nextAiringEpisode
                    ? `${media.nextAiringEpisode.episode}. bölüm · ${new Date(media.nextAiringEpisode.airingAt * 1000).toLocaleString("tr", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : null
                }
              />
              <InfoRow label="Sezon" value={media.season ? `${SEASON_TR[media.season] ?? media.season} ${media.seasonYear ?? ""}` : media.seasonYear} />
              <InfoRow label="Başlangıç" value={formatFuzzy(media.startDate)} />
              <InfoRow label="Bitiş" value={formatFuzzy(media.endDate)} />
              <InfoRow label="Stüdyo" value={media.studios.nodes.map((s) => s.name).join(", ")} />
              <InfoRow label="Kaynak" value={SOURCE_TR[media.source ?? ""] ?? media.source} />
              {rankings.map((r, i) => (
                <InfoRow key={i} label={r.type === "RATED" ? "Puan sırası" : "Popülerlik sırası"} value={`#${r.rank} ${r.allTime ? "tüm zamanlar" : `${r.season ? SEASON_TR[r.season] + " " : ""}${r.year}`}`} />
              ))}
              {media.synonyms.length > 0 && <InfoRow label="Diğer adlar" value={media.synonyms.slice(0, 3).join(", ")} />}
            </Section>
          )}

          <Section title="Bağlantılar">
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {[
                anime?.AnimeLink && /^https?:\/\//.test(anime.AnimeLink) ? { site: "İzleme linki", url: anime.AnimeLink } : null,
                malId ? { site: "MyAnimeList", url: `https://myanimelist.net/anime/${malId}` } : null,
                media ? { site: "AniList", url: media.siteUrl } : null,
                ...(media?.externalLinks ?? []).filter((l) => l.type === "STREAMING" || l.site === "Official Site").map((l) => ({ site: l.site, url: l.url })),
              ]
                .filter((l): l is { site: string; url: string } => Boolean(l))
                .map((l) => (
                  <Box
                    key={l.url}
                    component="a"
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 0.5,
                      height: 30,
                      px: 1.25,
                      borderRadius: "8px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: palette.text,
                      textDecoration: "none",
                      backgroundColor: alpha(palette.overlay, 0.05),
                      border: `1px solid ${alpha(palette.overlay, 0.08)}`,
                      "&:hover": { backgroundColor: alpha(palette.overlay, 0.09) },
                    }}
                  >
                    {l.site}
                    <OpenInNewRoundedIcon sx={{ fontSize: 14, color: palette.textMuted }} />
                  </Box>
                ))}
            </Box>
          </Section>
        </Box>

        {/* Sağ sütun */}
        <Box sx={{ display: "grid", gap: 2.5, minWidth: 0 }}>
          {description && (
            <Section title="Konu">
              <Typography
                sx={{
                  fontSize: "0.9rem",
                  lineHeight: 1.7,
                  color: palette.text,
                  whiteSpace: "pre-wrap",
                  ...(expanded ? {} : { display: "-webkit-box", WebkitLineClamp: 7, WebkitBoxOrient: "vertical", overflow: "hidden" }),
                }}
              >
                {description}
              </Typography>
              {description.length > 500 && (
                <Button size="small" onClick={() => setExpanded((v) => !v)} sx={{ mt: 0.5, px: 0 }}>
                  {expanded ? "Daha az" : "Devamını oku"}
                </Button>
              )}
              <Typography sx={{ fontSize: "0.7rem", color: palette.textFaint, mt: 1 }}>Açıklama AniList&apos;ten (İngilizce).</Typography>
            </Section>
          )}

          {media?.trailer?.site === "youtube" && (
            <Section title="Fragman">
              <Box sx={{ position: "relative", aspectRatio: "16/9", borderRadius: "12px", overflow: "hidden", backgroundColor: "#000" }}>
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${media.trailer.id}`}
                  title="Fragman"
                  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
              </Box>
            </Section>
          )}

          {relations.length > 0 && (
            <Section title="İlişkili animeler">
              <Box sx={cardGrid}>
                {relations.map((e) => (
                  <MediaCard key={e.node.id} m={e.node} caption={RELATION_TR[e.relationType] ?? e.relationType} localId={localIdOf(e.node)} />
                ))}
              </Box>
            </Section>
          )}

          {(media?.characters.edges.length ?? 0) > 0 && (
            <Section title="Karakterler">
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 1 }}>
                {media!.characters.edges.map((c) => (
                  <Box key={c.node.id} sx={{ display: "flex", alignItems: "center", gap: 1.25, p: 0.75, borderRadius: "10px", backgroundColor: alpha(palette.overlay, 0.03) }}>
                    {c.node.image?.medium ? <img src={c.node.image.medium} alt="" loading="lazy" style={{ width: 40, height: 56, objectFit: "cover", borderRadius: 6 }} /> : <Box sx={{ width: 40, height: 56, borderRadius: "6px", backgroundColor: palette.surfaceRaised }} />}
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography noWrap sx={{ fontSize: "0.82rem", fontWeight: 600 }}>
                        {c.node.name.full}
                      </Typography>
                      <Typography noWrap sx={{ fontSize: "0.7rem", color: palette.textMuted }}>
                        {c.role === "MAIN" ? "Ana karakter" : c.role === "SUPPORTING" ? "Yan karakter" : "Figüran"}
                        {c.voiceActors[0] ? ` · ${c.voiceActors[0].name.full}` : ""}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Section>
          )}

          {tags.length > 0 && (
            <Section
              title="Etiketler"
              extra={
                spoilerCount > 0 && (
                  <Button size="small" onClick={() => setShowSpoilers((v) => !v)} sx={{ color: palette.textMuted }}>
                    {showSpoilers ? "Spoiler etiketleri gizle" : `${spoilerCount} spoiler etiketi göster`}
                  </Button>
                )
              }
            >
              <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                {tags.map((t) => (
                  <Tooltip key={t.name} title={`Uygunluk %${t.rank}`}>
                    <Chip
                      size="small"
                      label={t.name}
                      sx={{
                        backgroundColor: alpha(palette.overlay, 0.05),
                        color: t.isMediaSpoiler ? palette.danger : palette.text,
                        border: `1px solid ${alpha(palette.overlay, 0.08)}`,
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Section>
          )}

          {recs.length > 0 && (
            <Section title="Bunu sevenler bunları da sevdi">
              <Box sx={cardGrid}>
                {recs.map((m) => (
                  <MediaCard key={m.id} m={m} localId={localIdOf(m)} />
                ))}
              </Box>
            </Section>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default function AnimeDetailPage() {
  return (
    <Suspense fallback={<LinearProgress />}>
      <DetailContent />
    </Suspense>
  );
}
