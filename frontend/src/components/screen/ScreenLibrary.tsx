"use client";

// Diziler (/series) ve filmler (/movies): aynı filtrelenmiş, sayfalı liste üzerinde grid ve tablo görünümü.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Pagination,
  Skeleton,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import TableRowsRoundedIcon from "@mui/icons-material/TableRowsRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import BookmarkRoundedIcon from "@mui/icons-material/BookmarkRounded";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import SortMenu from "../ui/SortMenu";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import LiveTvOutlinedIcon from "@mui/icons-material/LiveTvOutlined";
import TheatersOutlinedIcon from "@mui/icons-material/TheatersOutlined";
import { useAuth } from "../../contexts/AuthContext";
import { ScreenService, errorText, type ScreenKind, type ScreenQuery, type ScreenTitle } from "../../Services/ScreenService";
import { GenreChips } from "../Common/GenreChip";
import { palette } from "../../theme/customTheme";
import { useDelayedFlag } from "../../lib/useDelayedFlag";
import ScreenEditorDialog from "./ScreenEditorDialog";
import { KIND_TEXT, SERIES_STATUS_LABEL, WATCH_STATUS_COLOR, WATCH_STATUS_LABEL, progressText } from "./screenLabels";

type View = "grid" | "table";
type Toast = { severity: "success" | "error" | "info"; text: string } | null;
const PAGE_SIZE = 48;

// Filtreler telefonda ikişer ikişer sığar, geniş ekranda doğal genişliklerinde yan yana durur
const filterSx = { minWidth: { xs: 0, sm: 150 }, flex: { xs: "1 1 calc(50% - 4px)", sm: "0 0 auto" } };

export const KindIcon = ({ kind, ...props }: { kind: ScreenKind; fontSize?: "small" | "large" | "inherit"; sx?: object }) =>
  kind === "series" ? <LiveTvOutlinedIcon {...props} /> : <TheatersOutlinedIcon {...props} />;

export function WatchStatusChip({ status }: { status: ScreenTitle["watchStatus"] }) {
  if (!status) return null;
  const color = WATCH_STATUS_COLOR[status];
  return <Chip size="small" label={WATCH_STATUS_LABEL[status]} sx={{ height: 22, fontSize: "0.7rem", color, backgroundColor: alpha(color, 0.14) }} />;
}

/** Kartın alt satırı: dizide bölüm ilerlemesi, filmde yıl ve süre */
const subline = (t: ScreenTitle) =>
  t.kind === "series"
    ? [`${progressText(t.episodesWatched, t.totalEpisodes)} bölüm`, t.year].filter(Boolean).join(" · ")
    : [t.year, t.runtime].filter(Boolean).join(" · ");

function TitleCard({ t, onOpen, onEdit, onTogglePtw }: { t: ScreenTitle; onOpen: (t: ScreenTitle) => void; onEdit: (t: ScreenTitle) => void; onTogglePtw: (t: ScreenTitle) => void }) {
  const pct = t.kind === "series" && t.totalEpisodes ? Math.min(100, (t.episodesWatched / t.totalEpisodes) * 100) : 0;
  const overlayBtn = { color: "#fff", backgroundColor: alpha("#000", 0.55), "&:hover": { backgroundColor: alpha("#000", 0.75) } };
  return (
    <Box sx={{ borderRadius: "14px", overflow: "hidden", backgroundColor: palette.surface, border: `1px solid ${alpha(palette.overlay, 0.06)}`, display: "flex", flexDirection: "column", "&:hover .card-actions": { opacity: 1 } }}>
      <Box onClick={() => onOpen(t)} sx={{ position: "relative", aspectRatio: "2 / 3", cursor: "pointer", backgroundColor: palette.surfaceRaised }}>
        {t.cover ? (
          <img src={t.cover} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ height: "100%", display: "grid", placeItems: "center", color: palette.textFaint }}><KindIcon kind={t.kind} fontSize="large" /></Box>
        )}
        {(t.score > 0 || t.imdbRating > 0) && (
          <Chip size="small" icon={<StarRoundedIcon sx={{ fontSize: "14px !important" }} />} label={t.score > 0 ? t.score : `IMDb ${t.imdbRating}`}
            sx={{ position: "absolute", top: 8, left: 8, height: 22, backgroundColor: alpha("#000", 0.65), color: "#fff" }} />
        )}
        <Box className="card-actions" sx={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 0.5, opacity: { xs: 1, md: 0 }, transition: "opacity .15s" }}>
          <Tooltip title={t.planToWatch ? "İzleyeceklerimden çıkar" : "İzleyeceklerime ekle"}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onTogglePtw(t); }} sx={overlayBtn}>
              {t.planToWatch ? <BookmarkRoundedIcon fontSize="small" /> : <BookmarkBorderRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Düzenle">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(t); }} sx={overlayBtn}>
              <EditRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {pct > 0 && <LinearProgress variant="determinate" value={pct} sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4 }} />}
      </Box>
      <Box sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 0.5, flex: 1 }}>
        <Typography title={t.name} sx={{ fontWeight: 600, fontSize: "0.88rem", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {t.name}
        </Typography>
        <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>{subline(t)}</Typography>
        <Box sx={{ mt: "auto" }}><WatchStatusChip status={t.watchStatus} /></Box>
      </Box>
    </Box>
  );
}

const SORT_OPTIONS = [
  { value: "name", label: "Ad" },
  { value: "year", label: "Yıl" },
  { value: "watch-status", label: "İzleme durumu" },
  { value: "progress", label: "İzleme ilerlemesi" },
  { value: "score", label: "Puanım" },
  { value: "imdb-rating", label: "IMDb puanı" },
  { value: "updated", label: "Son güncellenen" },
  { value: "added", label: "Son eklenen" },
];

type Column = { key: string; label: string; sort?: string; align?: "right"; series?: boolean };
const COLUMNS: Column[] = [
  { key: "name", label: "Ad", sort: "name" },
  { key: "year", label: "Yıl", sort: "year" },
  { key: "status", label: "Yayın", sort: "status", series: true },
  { key: "watchStatus", label: "Durumum", sort: "watch-status" },
  { key: "progress", label: "Bölüm", sort: "progress", align: "right", series: true },
  { key: "score", label: "Puanım", sort: "score", align: "right" },
  { key: "imdb", label: "IMDb", sort: "imdb-rating", align: "right" },
  { key: "genres", label: "Türler" },
];

export default function ScreenLibrary({ kind }: { kind: ScreenKind }) {
  const router = useRouter();
  const { isAdmin, isAuthenticated } = useAuth();
  const text = KIND_TEXT[kind];
  const isSeries = kind === "series";
  const viewKey = isSeries ? "kirokuSeriesView" : "kirokuMoviesView";
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState<ScreenQuery>({ sort: "name", order: "asc", page: 1 });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ScreenTitle[]>([]);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [genres, setGenres] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Hızlı (ör. boş) yüklemelerde iskelet bir anlığına görünüp kaybolmasın
  const showSkeleton = useDelayedFlag(loading && !data.length);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<ScreenTitle | null | undefined>(undefined);
  const columns = COLUMNS.filter((c) => isSeries || !c.series);

  useEffect(() => {
    try {
      const v = localStorage.getItem(viewKey);
      if (v === "grid" || v === "table") setView(v);
      if (new URLSearchParams(window.location.search).get("new") === "1") setEditing(null);
    } catch {}
  }, [viewKey]);

  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ScreenService.list(kind, { ...query, count: PAGE_SIZE });
      setData(res.data);
      setPages(res.pagination.pages);
      setTotal(res.pagination.total);
      setError("");
    } catch (e) {
      setError(`Liste alınamadı: ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  }, [kind, query]);

  const loadGenres = useCallback(() => ScreenService.genres(kind).then(setGenres).catch(() => {}), [kind]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [load, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) loadGenres();
  }, [isAuthenticated, loadGenres]);

  const patch = (q: Partial<ScreenQuery>) => setQuery((prev) => ({ ...prev, ...q, page: q.page ?? 1 }));
  const changeView = (v: View | null) => {
    if (!v) return;
    setView(v);
    try {
      localStorage.setItem(viewKey, v);
    } catch {}
  };

  const togglePtw = async (t: ScreenTitle) => {
    try {
      const updated = await ScreenService.update(kind, t.id, { planToWatch: !t.planToWatch });
      setData((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setToast({ severity: "error", text: errorText(e) });
    }
  };

  const open = (t: ScreenTitle) => router.push(`${text.base}/detail?id=${t.id}`);
  const sortLabel = (col: Column) =>
    col.sort ? (
      <TableSortLabel active={query.sort === col.sort} direction={query.sort === col.sort ? query.order : "asc"}
        onClick={() => patch({ sort: col.sort, order: query.sort === col.sort && query.order === "asc" ? "desc" : "asc" })}>
        {col.label}
      </TableSortLabel>
    ) : col.label;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.015em" }}>{text.title}</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>{loading ? "Yükleniyor…" : `${total} ${text.one}`}</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEditing(null)}>{text.add}</Button>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => changeView(v)}>
            <ToggleButton value="grid" aria-label="Izgara"><GridViewRoundedIcon fontSize="small" /></ToggleButton>
            <ToggleButton value="table" aria-label="Tablo"><TableRowsRoundedIcon fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
        <TextField size="small" placeholder="Ara" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: { xs: 0, sm: 200 }, flex: { xs: "1 1 100%", sm: "1 1 200px" } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} />
        <TextField size="small" select label="Durumum" value={query.watchStatus ?? ""} onChange={(e) => patch({ watchStatus: e.target.value })} sx={filterSx}>
          <MenuItem value="">Hepsi</MenuItem>
          {Object.entries(WATCH_STATUS_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          <MenuItem value="NONE">Durum yok</MenuItem>
        </TextField>
        {isSeries && (
          <TextField size="small" select label="Yayın" value={query.status ?? ""} onChange={(e) => patch({ status: e.target.value })} sx={filterSx}>
            <MenuItem value="">Hepsi</MenuItem>
            {Object.entries(SERIES_STATUS_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        )}
        <TextField size="small" select label="Tür" value={query.genres ?? []} onChange={(e) => patch({ genres: e.target.value as unknown as string[] })}
          SelectProps={{ multiple: true, renderValue: (v) => (v as string[]).join(", ") }} sx={{ ...filterSx, maxWidth: { sm: 260 } }}>
          {genres.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
        </TextField>
        <Chip label="Listemdekiler" variant={query.mine ? "filled" : "outlined"} color={query.mine ? "primary" : "default"} onClick={() => patch({ mine: !query.mine })} sx={{ alignSelf: "center" }} />
        <Chip label="Plan to Watch" variant={query.ptw ? "filled" : "outlined"} color={query.ptw ? "primary" : "default"} onClick={() => patch({ ptw: !query.ptw })} sx={{ alignSelf: "center" }} />
        <SortMenu options={SORT_OPTIONS.filter((o) => isSeries || o.value !== "progress")} sort={query.sort ?? "name"} order={query.order ?? "asc"} onChange={(sort, order) => patch({ sort, order })} />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Tekrar dene</Button>}>{error}</Alert>}
      {!isAuthenticated && <Alert severity="info" sx={{ mb: 2 }}>{text.loginHint}</Alert>}

      {loading && !data.length ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2 }}>
          {showSkeleton && Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} variant="rounded" sx={{ aspectRatio: "2 / 3", height: "auto", borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />)}
        </Box>
      ) : !data.length && !error ? (
        <Box sx={{ textAlign: "center", py: 8, borderRadius: "16px", border: `1px dashed ${alpha(palette.overlay, 0.12)}` }}>
          <KindIcon kind={kind} sx={{ fontSize: 44, color: palette.primary, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 2 }}>{text.empty}</Typography>
          <Button variant="contained" onClick={() => setEditing(null)}>{text.add}</Button>
        </Box>
      ) : view === "grid" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2, opacity: loading ? 0.6 : 1 }}>
          {data.map((t) => <TitleCard key={t.id} t={t} onOpen={open} onEdit={setEditing} onTogglePtw={togglePtw} />)}
        </Box>
      ) : (
        <Box sx={{ overflowX: "auto", borderRadius: "14px", border: `1px solid ${alpha(palette.overlay, 0.06)}`, opacity: loading ? 0.6 : 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((c) => <TableCell key={c.key} align={c.align}>{sortLabel(c)}</TableCell>)}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((t) => (
                <TableRow key={t.id} hover sx={{ cursor: "pointer" }} onClick={() => open(t)}>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                      {t.cover && <img src={t.cover} alt="" loading="lazy" style={{ width: 32, height: 46, objectFit: "cover", borderRadius: 4 }} />}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: "0.85rem", fontWeight: 600 }}>{t.name}</Typography>
                        {t.originalName && <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>{t.originalName}</Typography>}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>{t.year || "—"}</TableCell>
                  {isSeries && <TableCell>{SERIES_STATUS_LABEL[t.status] ?? (t.status || "—")}</TableCell>}
                  <TableCell><WatchStatusChip status={t.watchStatus} /></TableCell>
                  {isSeries && <TableCell align="right">{progressText(t.episodesWatched, t.totalEpisodes)}</TableCell>}
                  <TableCell align="right">{t.score || "—"}</TableCell>
                  <TableCell align="right">{t.imdbRating ? t.imdbRating.toFixed(1) : "—"}</TableCell>
                  <TableCell sx={{ minWidth: 180 }}><GenreChips genres={t.genres} max={3} justify="flex-start" /></TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <Box sx={{ display: "flex" }}>
                      <IconButton size="small" onClick={() => togglePtw(t)}>{t.planToWatch ? <BookmarkRoundedIcon fontSize="small" /> : <BookmarkBorderRoundedIcon fontSize="small" />}</IconButton>
                      <IconButton size="small" onClick={() => setEditing(t)}><EditRoundedIcon fontSize="small" /></IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {pages > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
          <Pagination count={pages} page={query.page ?? 1} onChange={(_, page) => patch({ page })} />
        </Box>
      )}

      <ScreenEditorDialog
        kind={kind}
        open={editing !== undefined}
        title={editing ?? null}
        isAdmin={isAdmin}
        onClose={() => setEditing(undefined)}
        onSaved={(t) => {
          setEditing(undefined);
          setToast({ severity: "success", text: `“${t.name}” kaydedildi` });
          load();
          loadGenres();
        }}
      />

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {toast ? <Alert onClose={() => setToast(null)} severity={toast.severity} variant="filled">{toast.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
