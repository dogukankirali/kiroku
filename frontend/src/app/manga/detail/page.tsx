"use client";

// Manga detail (/manga/detail?id=…): Kiroku record + AniList details (queried from the browser) + chapter list
// (MangaDex chapters read live, uploaded chapters served from R2).

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Skeleton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { useAuth } from "../../../contexts/AuthContext";
import { ChapterService, MangaService, errorText, type Chapter, type Manga } from "../../../Services/MangaService";
import { fetchMediaDetail, formatFuzzy, plainDescription, type MediaDetail } from "../../../lib/anilistDetail";
import { GenreChips } from "../../../components/Common/GenreChip";
import MangaEditorDialog from "../../../components/manga/MangaEditorDialog";
import { LibraryChapterForm, LibrarySettings, MangaDexPanel } from "../../../components/manga/ChapterSourcesPanel";
import { chapterLabel, FORMAT_LABEL, PUB_STATUS_LABEL, READ_STATUS_COLOR, READ_STATUS_LABEL, progressText } from "../../../components/manga/mangaLabels";
import { palette } from "../../../theme/customTheme";

const card = { p: { xs: 2, md: 2.5 }, borderRadius: "16px", backgroundColor: palette.surface, border: `1px solid ${alpha(palette.overlay, 0.06)}` };

function MangaDetail() {
  const id = Number(useSearchParams().get("id"));
  const { isAdmin, isAuthenticated } = useAuth();
  const [manga, setManga] = useState<Manga | null>(null);
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lang, setLang] = useState<string>("all");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const loadChapters = useCallback(() => {
    ChapterService.list(id).then(setChapters).catch((e) => setError(errorText(e)));
  }, [id]);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    MangaService.get(id).then(setManga).catch((e) => setError(errorText(e)));
    loadChapters();
  }, [id, isAuthenticated, loadChapters]);

  useEffect(() => {
    if (!manga) return;
    const ctrl = new AbortController();
    fetchMediaDetail({ anilistId: manga.anilistId, malId: manga.malId, name: manga.name, type: "MANGA" }, ctrl.signal)
      .then(setDetail)
      .catch(() => {});
    return () => ctrl.abort();
  }, [manga?.id, manga?.anilistId]); // eslint-disable-line react-hooks/exhaustive-deps

  const langs = useMemo(() => [...new Set(chapters.map((c) => c.lang))].sort(), [chapters]);
  const visible = lang === "all" ? chapters : chapters.filter((c) => c.lang === lang);
  // Resume: first chapter after the saved progress (prefers the selected language)
  const next = useMemo(() => {
    if (!manga) return null;
    return visible.find((c) => c.number > manga.chaptersRead) ?? null;
  }, [visible, manga]);

  const remove = async (ch: Chapter) => {
    if (!confirm(`${chapterLabel(ch)} silinsin mi?`)) return;
    try {
      await ChapterService.remove(ch.id);
      loadChapters();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!id) return <Alert severity="error">Geçersiz manga</Alert>;
  if (error && !manga) return <Alert severity="error">{error}</Alert>;
  if (!manga) return <Skeleton variant="rounded" height={320} sx={{ borderRadius: "16px" }} />;

  const desc = plainDescription(detail?.description ?? null);
  const color = manga.readStatus ? READ_STATUS_COLOR[manga.readStatus] : palette.textMuted;

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Button component={Link} href="/manga" startIcon={<ArrowBackRoundedIcon />} size="small">Manga</Button>
      </Box>
      {detail?.bannerImage && (
        <Box sx={{ height: { xs: 120, md: 200 }, borderRadius: "16px", backgroundImage: `url(${detail.bannerImage})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      )}
      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

      <Box sx={{ ...card, display: "flex", gap: 2.5, flexDirection: { xs: "column", sm: "row" } }}>
        {manga.cover && <img src={manga.cover} alt="" style={{ width: 180, borderRadius: 12, alignSelf: "flex-start", objectFit: "cover" }} />}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2 }}>{manga.name}</Typography>
              {(manga.englishName || detail?.title.native) && (
                <Typography sx={{ color: palette.textMuted, fontSize: "0.9rem" }}>{[manga.englishName, detail?.title.native].filter(Boolean).join(" · ")}</Typography>
              )}
            </Box>
            <Tooltip title="Düzenle"><IconButton onClick={() => setEditing(true)}><EditRoundedIcon /></IconButton></Tooltip>
          </Box>
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
            {manga.readStatus && <Chip size="small" label={READ_STATUS_LABEL[manga.readStatus]} sx={{ color, backgroundColor: alpha(color, 0.14) }} />}
            {manga.seriesName && <Chip size="small" variant="outlined" label={`Seri: ${manga.seriesName}`} />}
            {manga.format && <Chip size="small" label={FORMAT_LABEL[manga.format] ?? manga.format} />}
            {manga.status && <Chip size="small" label={PUB_STATUS_LABEL[manga.status] ?? manga.status} />}
            {manga.malScore > 0 && <Chip size="small" label={`Ortalama ${manga.malScore.toFixed(1)}`} />}
            {manga.score > 0 && <Chip size="small" color="primary" label={`Puanım ${manga.score}`} />}
          </Box>
          <Box sx={{ maxWidth: 420 }}>
            <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>
              {progressText(manga.chaptersRead, manga.totalChapters)} bölüm · {progressText(manga.volumesRead, manga.totalVolumes)} cilt
            </Typography>
            {manga.totalChapters > 0 && <LinearProgress variant="determinate" value={Math.min(100, (manga.chaptersRead / manga.totalChapters) * 100)} sx={{ height: 5, borderRadius: 3, mt: 0.5 }} />}
          </Box>
          <GenreChips genres={manga.genres} justify="flex-start" />
          {desc && <Typography sx={{ fontSize: "0.88rem", whiteSpace: "pre-line", color: palette.textMuted, maxHeight: 220, overflowY: "auto" }}>{desc}</Typography>}
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", fontSize: "0.78rem", color: palette.textMuted }}>
            {detail?.startDate && formatFuzzy(detail.startDate) && <span>Başlangıç: {formatFuzzy(detail.startDate)}</span>}
            {detail?.endDate && formatFuzzy(detail.endDate) && <span>Bitiş: {formatFuzzy(detail.endDate)}</span>}
            {detail?.siteUrl && <a href={detail.siteUrl} target="_blank" rel="noreferrer" style={{ color: palette.primary }}>AniList <OpenInNewRoundedIcon sx={{ fontSize: 12 }} /></a>}
            {manga.malLink && <a href={manga.malLink} target="_blank" rel="noreferrer" style={{ color: palette.primary }}>MyAnimeList <OpenInNewRoundedIcon sx={{ fontSize: 12 }} /></a>}
          </Box>
          {next && (
            <Box>
              <Button variant="contained" component={Link} href={`/manga/read?id=${manga.id}&ch=${next.id}`}>
                {manga.chaptersRead > 0 ? "Devam et" : "Okumaya başla"}: Bölüm {next.number}
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={card}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
          <Typography sx={{ fontWeight: 600 }}>Bölümler ({visible.length})</Typography>
          {langs.length > 1 && (
            <ToggleButtonGroup size="small" exclusive value={lang} onChange={(_, v) => v && setLang(v)}>
              <ToggleButton value="all">Hepsi</ToggleButton>
              {langs.map((l) => <ToggleButton key={l} value={l}>{l.toUpperCase()}</ToggleButton>)}
            </ToggleButtonGroup>
          )}
        </Box>
        {!visible.length ? (
          <Typography sx={{ fontSize: "0.85rem", color: palette.textMuted }}>
            Henüz bölüm yok. Aşağıdan kütüphanendeki CBZ dosyalarını ekleyebilirsin.
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", maxHeight: 520, overflowY: "auto" }}>
            {visible.map((ch) => {
              const read = ch.number <= manga.chaptersRead;
              return (
                <Box key={ch.id} sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.75, borderRadius: "8px", "&:hover": { backgroundColor: palette.surfaceRaised } }}>
                  <Box component={Link} href={`/manga/read?id=${manga.id}&ch=${ch.id}`} sx={{ flex: 1, minWidth: 0, textDecoration: "none", color: read ? palette.textMuted : palette.text }}>
                    <Typography noWrap sx={{ fontSize: "0.88rem", fontWeight: read ? 400 : 600 }}>{chapterLabel(ch)}</Typography>
                    <Typography noWrap sx={{ fontSize: "0.7rem", color: palette.textFaint }}>
                      {[ch.lang.toUpperCase(), ch.groupName, `${ch.pageCount} sayfa`, ch.publishedAt?.slice(0, 10)].filter(Boolean).join(" · ")}
                    </Typography>
                  </Box>
                  {ch.filePath && <Tooltip title={`Kütüphanemde: ${ch.filePath}`}><CloudDoneOutlinedIcon sx={{ fontSize: 18, color: palette.textMuted }} /></Tooltip>}
                  {(isAdmin || ch.filePath) && <IconButton size="small" onClick={() => remove(ch)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <Box sx={{ ...card, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3 }}>
        <LibrarySettings />
        <LibraryChapterForm manga={manga} nextNumber={Math.floor(Math.max(0, ...chapters.map((c) => c.number))) + 1} onChanged={loadChapters} />
        {isAdmin && <MangaDexPanel manga={manga} onChanged={loadChapters} />}
      </Box>

      <MangaEditorDialog open={editing} manga={manga} isAdmin={isAdmin} onClose={() => setEditing(false)} onSaved={(m) => { setManga(m); setEditing(false); }} />
    </Box>
  );
}

export default function MangaDetailPage() {
  return (
    <Suspense fallback={<Skeleton variant="rounded" height={320} sx={{ borderRadius: "16px" }} />}>
      <MangaDetail />
    </Suspense>
  );
}
