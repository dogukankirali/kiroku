"use client";

// Manga library (/manga): grid and table views over the same filtered, paginated list.

import { useCallback, useEffect, useMemo, useState } from "react";
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
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import BookmarkRoundedIcon from "@mui/icons-material/BookmarkRounded";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import SortMenu from "../ui/SortMenu";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import { useAuth } from "../../contexts/AuthContext";
import { MangaService, errorText, fromAniList, type Manga, type MangaQuery } from "../../Services/MangaService";
import { AniListRateLimit, mangaForSync } from "../../Services/anilist";
import { GenreChips } from "../Common/GenreChip";
import { palette } from "../../theme/customTheme";
import { useDelayedFlag } from "../../lib/useDelayedFlag";
import MangaEditorDialog from "./MangaEditorDialog";
import LibrarySyncDialog from "./LibrarySyncDialog";
import FolderSyncRoundedIcon from "@mui/icons-material/FolderCopyOutlined";
import { PUB_STATUS_LABEL, READ_STATUS_COLOR, READ_STATUS_LABEL, progressText } from "./mangaLabels";

type View = "grid" | "table";
type Toast = { severity: "success" | "error" | "info"; text: string } | null;

const VIEW_KEY = "kirokuMangaView";
const PAGE_SIZE = 48;

export type MangaOpen = (m: Manga) => void;

function ReadStatusChip({ status }: { status: Manga["readStatus"] }) {
  if (!status) return null;
  const color = READ_STATUS_COLOR[status];
  return <Chip size="small" label={READ_STATUS_LABEL[status]} sx={{ height: 22, fontSize: "0.7rem", color, backgroundColor: alpha(color, 0.14) }} />;
}

function MangaCard({ m, onOpen, onEdit, onTogglePtr }: { m: Manga; onOpen: MangaOpen; onEdit: MangaOpen; onTogglePtr: MangaOpen }) {
  const pct = m.totalChapters ? Math.min(100, (m.chaptersRead / m.totalChapters) * 100) : 0;
  return (
    <Box sx={{ borderRadius: "14px", overflow: "hidden", backgroundColor: palette.surface, border: `1px solid ${alpha(palette.overlay, 0.06)}`, display: "flex", flexDirection: "column", "&:hover .card-actions": { opacity: 1 } }}>
      <Box onClick={() => onOpen(m)} sx={{ position: "relative", aspectRatio: "2 / 3", cursor: "pointer", backgroundColor: palette.surfaceRaised }}>
        {m.cover ? (
          <img src={m.cover} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ height: "100%", display: "grid", placeItems: "center", color: palette.textFaint }}><MenuBookOutlinedIcon fontSize="large" /></Box>
        )}
        {m.score > 0 && (
          <Chip size="small" icon={<StarRoundedIcon sx={{ fontSize: "14px !important" }} />} label={m.score}
            sx={{ position: "absolute", top: 8, left: 8, height: 22, backgroundColor: alpha("#000", 0.65), color: "#fff" }} />
        )}
        <Box className="card-actions" sx={{ position: "absolute", top: 4, right: 4, display: "flex", opacity: { xs: 1, md: 0 }, transition: "opacity .15s" }}>
          <Tooltip title={m.planToRead ? "Okuma listesinden çıkar" : "Okuma listesine ekle"}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onTogglePtr(m); }} sx={{ color: "#fff", backgroundColor: alpha("#000", 0.55), mr: 0.5, "&:hover": { backgroundColor: alpha("#000", 0.75) } }}>
              {m.planToRead ? <BookmarkRoundedIcon fontSize="small" /> : <BookmarkBorderRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Düzenle">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(m); }} sx={{ color: "#fff", backgroundColor: alpha("#000", 0.55), "&:hover": { backgroundColor: alpha("#000", 0.75) } }}>
              <EditRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {pct > 0 && <LinearProgress variant="determinate" value={pct} sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4 }} />}
      </Box>
      <Box sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 0.5, flex: 1 }}>
        <Typography title={m.name} sx={{ fontWeight: 600, fontSize: "0.88rem", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {m.name}
        </Typography>
        <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>
          {progressText(m.chaptersRead, m.totalChapters)} bölüm{m.status ? ` · ${PUB_STATUS_LABEL[m.status] ?? m.status}` : ""}
        </Typography>
        <Box sx={{ mt: "auto" }}><ReadStatusChip status={m.readStatus} /></Box>
      </Box>
    </Box>
  );
}

const SORT_OPTIONS = [
  { value: "name", label: "Ad" },
  { value: "read-status", label: "Okuma durumu" },
  { value: "progress", label: "Okuma ilerlemesi" },
  { value: "score", label: "Puanım" },
  { value: "mal-score", label: "MAL puanı" },
  { value: "updated", label: "Son güncellenen" },
  { value: "added", label: "Son eklenen" },
];

const COLUMNS: { key: string; label: string; sort?: string; align?: "right" }[] = [
  { key: "name", label: "Ad", sort: "name" },
  { key: "series", label: "Seri" },
  { key: "status", label: "Yayın", sort: "status" },
  { key: "readStatus", label: "Durumum", sort: "read-status" },
  { key: "progress", label: "Bölüm", sort: "progress", align: "right" },
  { key: "volumes", label: "Cilt", align: "right" },
  { key: "score", label: "Puanım", sort: "score", align: "right" },
  { key: "malScore", label: "Ortalama", sort: "mal-score", align: "right" },
  { key: "genres", label: "Türler" },
];

// Filtreler telefonda ikişer ikişer sığar, geniş ekranda doğal genişliklerinde yan yana durur
const filterSx = { minWidth: { xs: 0, sm: 150 }, flex: { xs: "1 1 calc(50% - 4px)", sm: "0 0 auto" } };

export default function MangaLibrary() {
  const router = useRouter();
  const { isAdmin, isAuthenticated } = useAuth();
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState<MangaQuery>({ sort: "name", order: "asc", page: 1 });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Manga[]>([]);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [genres, setGenres] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Hızlı (ör. boş) yüklemelerde iskelet bir anlığına görünüp kaybolmasın
  const showSkeleton = useDelayedFlag(loading && !data.length);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<Manga | null | undefined>(undefined);
  const [librarySync, setLibrarySync] = useState(false);
  const [syncing, setSyncing] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "table") setView(v);
      if (new URLSearchParams(window.location.search).get("new") === "1") setEditing(null);
    } catch {}
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await MangaService.list({ ...query, count: PAGE_SIZE });
      setData(res.data);
      setPages(res.pagination.pages);
      setTotal(res.pagination.total);
      setError("");
    } catch (e) {
      setError(`Manga listesi alınamadı: ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [load, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) MangaService.genres().then(setGenres).catch(() => {});
  }, [isAuthenticated]);

  const patch = (q: Partial<MangaQuery>) => setQuery((prev) => ({ ...prev, ...q, page: q.page ?? 1 }));
  const changeView = (v: View | null) => {
    if (!v) return;
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const replace = (m: Manga) => setData((list) => list.map((x) => (x.id === m.id ? m : x)));

  const togglePtr = async (m: Manga) => {
    try {
      replace(await MangaService.update(m.id, { planToRead: !m.planToRead }));
    } catch (e) {
      setToast({ severity: "error", text: errorText(e) });
    }
  };

  // Admin: refresh catalog data from AniList (browser → AniList, results → Worker) in groups of 10
  const syncAll = async () => {
    try {
      const all: Manga[] = [];
      for (let page = 1; ; page++) {
        const res = await MangaService.list({ page, count: 500 });
        all.push(...res.data);
        if (page >= res.pagination.pages) break;
      }
      setSyncing({ done: 0, total: all.length });
      let updated = 0;
      for (let i = 0; i < all.length; i += 10) {
        const group = all.slice(i, i + 10);
        let found: Awaited<ReturnType<typeof mangaForSync>>;
        try {
          found = await mangaForSync(group.map((m) => ({ anilistId: m.anilistId, malId: m.malId, name: m.name })));
        } catch (e) {
          if (e instanceof AniListRateLimit) {
            await new Promise((r) => setTimeout(r, e.retryAfter * 1000));
            i -= 10;
            continue;
          }
          throw e;
        }
        const items = group.flatMap((m, idx) => {
          const a = found[idx];
          if (!a) return [];
          const { name: _name, ...fields } = fromAniList(a);
          // Name lookups can hit a different entry; never steal an AniList id another row already owns
          if (!m.anilistId && all.some((o) => o.anilistId === a.id)) return [];
          return [{ id: m.id, ...fields }];
        });
        if (items.length) updated += (await MangaService.syncBatch(items)).updated;
        setSyncing({ done: Math.min(i + 10, all.length), total: all.length });
      }
      setToast({ severity: "success", text: `Sync tamamlandı: ${updated} manga güncellendi` });
      load();
    } catch (e) {
      setToast({ severity: "error", text: `Sync başarısız: ${errorText(e)}` });
    } finally {
      setSyncing(null);
    }
  };

  const open = (m: Manga) => router.push(`/manga/detail?id=${m.id}`);
  const sortLabel = (col: (typeof COLUMNS)[number]) =>
    col.sort ? (
      <TableSortLabel active={query.sort === col.sort} direction={query.sort === col.sort ? query.order : "asc"}
        onClick={() => patch({ sort: col.sort, order: query.sort === col.sort && query.order === "asc" ? "desc" : "asc" })}>
        {col.label}
      </TableSortLabel>
    ) : col.label;

  const genreOptions = useMemo(() => genres, [genres]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.015em" }}>Manga</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>{loading ? "Yükleniyor…" : `${total} manga`}</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          {isAdmin && (
            <Button variant="outlined" startIcon={<SyncRoundedIcon />} disabled={Boolean(syncing)} onClick={syncAll}>
              {syncing ? `Sync ${syncing.done}/${syncing.total}` : "AniList Sync"}
            </Button>
          )}
          <Button variant="outlined" startIcon={<FolderSyncRoundedIcon />} onClick={() => setLibrarySync(true)}>Kütüphane sync</Button>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEditing(null)}>Manga ekle</Button>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => changeView(v)}>
            <ToggleButton value="grid" aria-label="Izgara"><GridViewRoundedIcon fontSize="small" /></ToggleButton>
            <ToggleButton value="table" aria-label="Tablo"><TableRowsRoundedIcon fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
        <TextField size="small" placeholder="Ara" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: { xs: 0, sm: 200 }, flex: { xs: "1 1 100%", sm: "1 1 200px" } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} />
        <TextField size="small" select label="Durumum" value={query.readStatus ?? ""} onChange={(e) => patch({ readStatus: e.target.value })} sx={filterSx}>
          <MenuItem value="">Hepsi</MenuItem>
          {Object.entries(READ_STATUS_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          <MenuItem value="NONE">Durum yok</MenuItem>
        </TextField>
        <TextField size="small" select label="Yayın" value={query.status ?? ""} onChange={(e) => patch({ status: e.target.value })} sx={filterSx}>
          <MenuItem value="">Hepsi</MenuItem>
          {Object.entries(PUB_STATUS_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Tür" value={query.genres ?? []} onChange={(e) => patch({ genres: e.target.value as unknown as string[] })}
          SelectProps={{ multiple: true, renderValue: (v) => (v as string[]).join(", ") }} sx={{ ...filterSx, maxWidth: { sm: 260 } }}>
          {genreOptions.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
        </TextField>
        <Chip label="Listemdekiler" variant={query.mine ? "filled" : "outlined"} color={query.mine ? "primary" : "default"} onClick={() => patch({ mine: !query.mine })} sx={{ alignSelf: "center" }} />
        <Chip label="Plan to Read" variant={query.ptr ? "filled" : "outlined"} color={query.ptr ? "primary" : "default"} onClick={() => patch({ ptr: !query.ptr })} sx={{ alignSelf: "center" }} />
        <SortMenu options={SORT_OPTIONS} sort={query.sort ?? "name"} order={query.order ?? "asc"} onChange={(sort, order) => patch({ sort, order })} />
      </Box>

      {syncing && <LinearProgress variant="determinate" value={(syncing.done / Math.max(1, syncing.total)) * 100} sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Tekrar dene</Button>}>{error}</Alert>}
      {!isAuthenticated && <Alert severity="info" sx={{ mb: 2 }}>Manga listesini görmek için giriş yap.</Alert>}

      {loading && !data.length ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2 }}>
          {showSkeleton && Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} variant="rounded" sx={{ aspectRatio: "2 / 3", height: "auto", borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />)}
        </Box>
      ) : !data.length && !error ? (
        <Box sx={{ textAlign: "center", py: 8, borderRadius: "16px", border: `1px dashed ${alpha(palette.overlay, 0.12)}` }}>
          <MenuBookOutlinedIcon sx={{ fontSize: 44, color: palette.primary, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Burada henüz manga yok</Typography>
          <Button variant="contained" onClick={() => setEditing(null)}>İlk mangayı ekle</Button>
        </Box>
      ) : view === "grid" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2, opacity: loading ? 0.6 : 1 }}>
          {data.map((m) => <MangaCard key={m.id} m={m} onOpen={open} onEdit={setEditing} onTogglePtr={togglePtr} />)}
        </Box>
      ) : (
        <Box sx={{ overflowX: "auto", borderRadius: "14px", border: `1px solid ${alpha(palette.overlay, 0.06)}`, opacity: loading ? 0.6 : 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {COLUMNS.map((c) => <TableCell key={c.key} align={c.align}>{sortLabel(c)}</TableCell>)}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.id} hover sx={{ cursor: "pointer" }} onClick={() => open(m)}>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                      {m.cover && <img src={m.cover} alt="" loading="lazy" style={{ width: 32, height: 46, objectFit: "cover", borderRadius: 4 }} />}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: "0.85rem", fontWeight: 600 }}>{m.name}</Typography>
                        {m.englishName && <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>{m.englishName}</Typography>}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>{m.seriesName || "—"}</TableCell>
                  <TableCell>{PUB_STATUS_LABEL[m.status] ?? m.status}</TableCell>
                  <TableCell><ReadStatusChip status={m.readStatus} /></TableCell>
                  <TableCell align="right">{progressText(m.chaptersRead, m.totalChapters)}</TableCell>
                  <TableCell align="right">{progressText(m.volumesRead, m.totalVolumes)}</TableCell>
                  <TableCell align="right">{m.score || "—"}</TableCell>
                  <TableCell align="right">{m.malScore ? m.malScore.toFixed(1) : "—"}</TableCell>
                  <TableCell sx={{ minWidth: 180 }}><GenreChips genres={m.genres} max={3} justify="flex-start" /></TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <Box sx={{ display: "flex" }}>
                      <IconButton size="small" onClick={() => togglePtr(m)}>{m.planToRead ? <BookmarkRoundedIcon fontSize="small" /> : <BookmarkBorderRoundedIcon fontSize="small" />}</IconButton>
                      <IconButton size="small" onClick={() => setEditing(m)}><EditRoundedIcon fontSize="small" /></IconButton>
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

      <MangaEditorDialog
        open={editing !== undefined}
        manga={editing ?? null}
        isAdmin={isAdmin}
        onClose={() => setEditing(undefined)}
        onSaved={(m) => {
          setEditing(undefined);
          setToast({ severity: "success", text: `“${m.name}” kaydedildi` });
          load();
          MangaService.genres().then(setGenres).catch(() => {});
        }}
      />

      <LibrarySyncDialog open={librarySync} onClose={() => setLibrarySync(false)} onDone={() => { load(); MangaService.genres().then(setGenres).catch(() => {}); }} />

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {toast ? <Alert onClose={() => setToast(null)} severity={toast.severity} variant="filled">{toast.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
