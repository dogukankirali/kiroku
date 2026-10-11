"use client";

// Waitlist (/waitlist): henüz yayınlanmamış, beklenen animeler. Plan to Watch'tan ayrıdır (watchlist'te
// görünmez); anime arşivinde ve tabloda yer alır. Yayın başlayınca ve yeni bölüm çıkınca bildirimler bu
// listedekilere de gider. Ekleme AniList'te yayınlanmamış animeler arasında aramayla yapılır.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import BookmarkAddRoundedIcon from "@mui/icons-material/BookmarkAddRounded";
import HourglassTopRoundedIcon from "@mui/icons-material/HourglassTopRounded";
import { toast } from "sonner";
import { API_BASE } from "../../Services/http";
import { anilistQuery } from "../../Services/anilist";
import { palette } from "../../theme/customTheme";
import { useDelayedFlag } from "../../lib/useDelayedFlag";
import { ANIME_STATUS_TR } from "../../components/anime/AnimeDetailModal";

type WaitAnime = {
  ID: number;
  Name: string;
  EnglishName: string;
  Cover: string;
  AnimeStatus: string;
  StartDate: string;
  NextEpisode: number;
  NextEpisodeAt: string;
  TotalNumberOfEpisodes: number;
  PlanToWatch: boolean;
};

type UpcomingMedia = {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null };
  format: string | null;
  episodes: number | null;
  status: string | null;
  genres: string[];
  coverImage: { extraLarge: string | null; large: string | null } | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
};

const fuzzyDate = (d: UpcomingMedia["startDate"]) =>
  d?.year ? [d.year, d.month, d.day].filter(Boolean).map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("-") : "";

/** "2027-01" → "Ocak 2027", "2027-01-10" → "10 Ocak 2027" */
function formatDate(value: string) {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!m) return String(y);
  return new Date(y, m - 1, d || 1).toLocaleDateString("tr", d ? { day: "numeric", month: "long", year: "numeric" } : { month: "long", year: "numeric" });
}

function whenText(a: WaitAnime) {
  if (a.NextEpisodeAt) return `${a.NextEpisode ? `${a.NextEpisode}. bölüm · ` : ""}${formatDate(a.NextEpisodeAt)}`;
  if (a.StartDate) return `Başlangıç: ${formatDate(a.StartDate)}`;
  return "Tarih belli değil";
}

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UpcomingMedia[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
    }
  }, [open]);

  // AniList'te yayınlanmamış animeler; arama boşsa en çok beklenenler
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await anilistQuery<{ Page: { media: UpcomingMedia[] } }>(
          `query ($search: String) { Page(perPage: 20) { media(type: ANIME, status: NOT_YET_RELEASED, search: $search, sort: [POPULARITY_DESC]) {
            id idMal title { romaji english } format episodes status genres coverImage { extraLarge large } startDate { year month day } } } }`,
          q.trim() ? { search: q.trim() } : {},
          ctrl.signal
        );
        setResults(data.Page.media);
      } catch {
        if (!ctrl.signal.aborted) toast.error("AniList araması başarısız");
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const add = async (m: UpcomingMedia) => {
    setAdding(m.id);
    try {
      await axios.post(`${API_BASE}/create-anime`, {
        Name: m.title.romaji || m.title.english,
        EnglishName: m.title.english ?? "",
        AnimeStatus: "Not yet aired",
        TotalNumberOfEpisodes: m.episodes ?? 0,
        IsMovie: m.format === "MOVIE",
        Genre: m.genres.join(", "),
        Cover: m.coverImage?.extraLarge ?? m.coverImage?.large ?? "",
        MALAnimeLink: m.idMal ? `https://myanimelist.net/anime/${m.idMal}` : "",
        StartDate: fuzzyDate(m.startDate),
        WaitList: true,
      });
      toast.success(`${m.title.romaji || m.title.english} waitlist'e eklendi`);
      onAdded();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Eklenemedi");
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Waitlist'e ekle</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          fullWidth
          label="Yayınlanmamış animelerde ara (boşsa en çok beklenenler)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{ endAdornment: searching ? <CircularProgress size={18} /> : null }}
        />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1.5, maxHeight: 420, overflowY: "auto" }}>
          {results.map((m) => (
            <Box key={m.id} sx={{ display: "flex", gap: 1.5, alignItems: "center", p: 1, borderRadius: "10px", border: `1px solid ${alpha(palette.overlay, 0.08)}` }}>
              {m.coverImage?.large && <img src={m.coverImage.large} alt="" style={{ width: 44, height: 62, objectFit: "cover", borderRadius: 6 }} />}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>{m.title.romaji || m.title.english}</Typography>
                <Typography noWrap sx={{ fontSize: "0.78rem", color: palette.textMuted }}>
                  {[m.title.english, m.format, fuzzyDate(m.startDate) ? formatDate(fuzzyDate(m.startDate)) : "Tarih belli değil"].filter(Boolean).join(" · ")}
                </Typography>
              </Box>
              <Button size="small" variant="outlined" disabled={adding === m.id} onClick={() => add(m)}>
                {adding === m.id ? "Ekleniyor…" : "Ekle"}
              </Button>
            </Box>
          ))}
          {!searching && !results.length && <Typography sx={{ color: palette.textMuted, fontSize: "0.85rem" }}>Sonuç yok.</Typography>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Kapat</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function WaitlistPage() {
  const [items, setItems] = useState<WaitAnime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  // Hızlı (ör. boş) yüklemelerde iskelet bir anlığına görünüp kaybolmasın
  const showSkeleton = useDelayedFlag(loading);

  const load = useCallback(async () => {
    try {
      setItems((await axios.get<WaitAnime[]>(`${API_BASE}/waitlist`)).data);
      setError("");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Waitlist alınamadı");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (a: WaitAnime) => {
    try {
      await axios.delete(`${API_BASE}/waitlist/${a.ID}`);
      setItems((list) => list.filter((x) => x.ID !== a.ID));
    } catch {
      toast.error("Çıkarılamadı");
    }
  };

  // Watchlist'e taşı: Plan to Watch açılır, waitlist'ten çıkar
  const moveToWatchlist = async (a: WaitAnime) => {
    try {
      await axios.post(`${API_BASE}/watchlist`, { anime_id: a.ID });
      await axios.delete(`${API_BASE}/waitlist/${a.ID}`);
      setItems((list) => list.filter((x) => x.ID !== a.ID));
      toast.success(`${a.Name} watchlist'e taşındı`);
    } catch {
      toast.error("Taşınamadı");
    }
  };

  return (
    <Box sx={{ maxWidth: 960, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.015em" }}>Waitlist</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>
            {loading ? "Yükleniyor…" : `${items.length} anime bekleniyor · yayın başlayınca bildirim gelir`}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAdding(true)}>
          Yayınlanmamış anime ekle
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {showSkeleton && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />)}
        </Box>
      ) : !items.length && !error ? (
        <Box sx={{ textAlign: "center", py: 8, borderRadius: "16px", border: `1px dashed ${alpha(palette.overlay, 0.12)}` }}>
          <HourglassTopRoundedIcon sx={{ fontSize: 44, color: palette.primary, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Waitlist boş</Typography>
          <Typography sx={{ fontSize: "0.85rem", color: palette.textMuted, mb: 2 }}>Henüz yayınlanmamış animeleri ekle; yayın başlayınca haber veririm.</Typography>
          <Button variant="contained" onClick={() => setAdding(true)}>Yayınlanmamış anime ekle</Button>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {items.map((a) => (
            <Box
              key={a.ID}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                p: 1.25,
                pr: 2,
                borderRadius: "14px",
                backgroundColor: palette.surface,
                border: `1px solid ${alpha(palette.overlay, 0.06)}`,
                "&:hover": { backgroundColor: palette.surfaceRaised },
              }}
            >
              <Box component={Link} href={`/anime/detail?id=${a.ID}`} sx={{ width: 52, height: 74, borderRadius: "8px", overflow: "hidden", flexShrink: 0, display: "block", backgroundColor: palette.surfaceRaised }}>
                {a.Cover && <img src={a.Cover} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  noWrap
                  component={Link}
                  href={`/anime/detail?id=${a.ID}`}
                  sx={{ display: "block", fontWeight: 600, fontSize: "0.95rem", mb: 0.5, color: "inherit", textDecoration: "none", "&:hover": { color: palette.primary } }}
                >
                  {a.Name}
                </Typography>
                <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
                  {a.AnimeStatus && (
                    <Chip
                      size="small"
                      label={ANIME_STATUS_TR[a.AnimeStatus] ?? a.AnimeStatus}
                      color={a.AnimeStatus === "Currently Airing" ? "success" : "default"}
                      sx={{ height: 22, fontSize: "0.7rem" }}
                    />
                  )}
                  <Typography sx={{ fontSize: "0.78rem", color: palette.textMuted }}>{whenText(a)}</Typography>
                </Box>
              </Box>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                {!a.PlanToWatch && (
                  <Tooltip title="Watchlist'e taşı">
                    <IconButton onClick={() => moveToWatchlist(a)} sx={{ color: palette.primary }}>
                      <BookmarkAddRoundedIcon />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Waitlist'ten çıkar">
                  <IconButton onClick={() => remove(a)} sx={{ color: palette.textMuted, "&:hover": { color: palette.danger } }}>
                    <DeleteOutlineRoundedIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <AddDialog open={adding} onClose={() => setAdding(false)} onAdded={load} />
    </Box>
  );
}
