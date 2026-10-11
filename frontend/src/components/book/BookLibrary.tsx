"use client";

// Kitaplar (/book): aynı filtrelenmiş, sayfalı liste üzerinde grid ve tablo görünümü.

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
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import { useAuth } from "../../contexts/AuthContext";
import { BookService, errorText, type Book, type BookQuery } from "../../Services/BookService";
import { GenreChips } from "../Common/GenreChip";
import { palette } from "../../theme/customTheme";
import { useDelayedFlag } from "../../lib/useDelayedFlag";
import BookEditorDialog from "./BookEditorDialog";
import { BOOK_STATUS_COLOR, BOOK_STATUS_LABEL, LANGUAGE_LABEL, pagesText, yearOf } from "./bookLabels";

type View = "grid" | "table";
type Toast = { severity: "success" | "error" | "info"; text: string } | null;
const VIEW_KEY = "kirokuBooksView";
const PAGE_SIZE = 48;

// Filtreler telefonda ikişer ikişer sığar, geniş ekranda doğal genişliklerinde yan yana durur
const filterSx = { minWidth: { xs: 0, sm: 150 }, flex: { xs: "1 1 calc(50% - 4px)", sm: "0 0 auto" } };

export function BookStatusChip({ status }: { status: Book["readStatus"] }) {
  if (!status) return null;
  const color = BOOK_STATUS_COLOR[status];
  return <Chip size="small" label={BOOK_STATUS_LABEL[status]} sx={{ height: 22, fontSize: "0.7rem", color, backgroundColor: alpha(color, 0.14) }} />;
}

function BookCard({ b, onOpen, onEdit, onTogglePtr }: { b: Book; onOpen: (b: Book) => void; onEdit: (b: Book) => void; onTogglePtr: (b: Book) => void }) {
  const pct = b.pageCount ? Math.min(100, (b.pagesRead / b.pageCount) * 100) : 0;
  const overlayBtn = { color: "#fff", backgroundColor: alpha("#000", 0.55), "&:hover": { backgroundColor: alpha("#000", 0.75) } };
  return (
    <Box sx={{ borderRadius: "14px", overflow: "hidden", backgroundColor: palette.surface, border: `1px solid ${alpha(palette.overlay, 0.06)}`, display: "flex", flexDirection: "column", "&:hover .card-actions": { opacity: 1 } }}>
      <Box onClick={() => onOpen(b)} sx={{ position: "relative", aspectRatio: "2 / 3", cursor: "pointer", backgroundColor: palette.surfaceRaised }}>
        {b.cover ? (
          <img src={b.cover} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ height: "100%", display: "grid", placeItems: "center", color: palette.textFaint }}><AutoStoriesOutlinedIcon fontSize="large" /></Box>
        )}
        {b.score > 0 && (
          <Chip size="small" icon={<StarRoundedIcon sx={{ fontSize: "14px !important" }} />} label={b.score}
            sx={{ position: "absolute", top: 8, left: 8, height: 22, backgroundColor: alpha("#000", 0.65), color: "#fff" }} />
        )}
        <Box className="card-actions" sx={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 0.5, opacity: { xs: 1, md: 0 }, transition: "opacity .15s" }}>
          <Tooltip title={b.planToRead ? "Okuyacaklarımdan çıkar" : "Okuyacaklarıma ekle"}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onTogglePtr(b); }} sx={overlayBtn}>
              {b.planToRead ? <BookmarkRoundedIcon fontSize="small" /> : <BookmarkBorderRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Düzenle">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(b); }} sx={overlayBtn}>
              <EditRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {pct > 0 && <LinearProgress variant="determinate" value={pct} sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4 }} />}
      </Box>
      <Box sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 0.5, flex: 1 }}>
        <Typography title={b.title} sx={{ fontWeight: 600, fontSize: "0.88rem", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {b.title}
        </Typography>
        <Typography noWrap sx={{ fontSize: "0.72rem", color: palette.textMuted }}>
          {[b.authors.join(", "), yearOf(b.publishedDate)].filter(Boolean).join(" · ")}
        </Typography>
        <Box sx={{ mt: "auto" }}><BookStatusChip status={b.readStatus} /></Box>
      </Box>
    </Box>
  );
}

const SORT_OPTIONS = [
  { value: "title", label: "Ad" },
  { value: "author", label: "Yazar" },
  { value: "year", label: "Yıl" },
  { value: "read-status", label: "Okuma durumu" },
  { value: "progress", label: "Okuma ilerlemesi" },
  { value: "score", label: "Puanım" },
  { value: "updated", label: "Son güncellenen" },
  { value: "added", label: "Son eklenen" },
];

type Column = { key: string; label: string; sort?: string; align?: "right" };
const COLUMNS: Column[] = [
  { key: "title", label: "Kitap", sort: "title" },
  { key: "author", label: "Yazar", sort: "author" },
  { key: "year", label: "Yıl", sort: "year" },
  { key: "readStatus", label: "Durumum", sort: "read-status" },
  { key: "progress", label: "Sayfa", sort: "progress", align: "right" },
  { key: "score", label: "Puanım", sort: "score", align: "right" },
  { key: "genres", label: "Türler" },
];

export default function BookLibrary() {
  const router = useRouter();
  const { isAdmin, isAuthenticated } = useAuth();
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState<BookQuery>({ sort: "title", order: "asc", page: 1 });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Book[]>([]);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [genres, setGenres] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Hızlı (ör. boş) yüklemelerde iskelet bir anlığına görünüp kaybolmasın
  const showSkeleton = useDelayedFlag(loading && !data.length);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<Book | null | undefined>(undefined);

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
      const res = await BookService.list({ ...query, count: PAGE_SIZE });
      setData(res.data);
      setPages(res.pagination.pages);
      setTotal(res.pagination.total);
      setError("");
    } catch (e) {
      setError(`Kitap listesi alınamadı: ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadGenres = useCallback(() => BookService.genres().then(setGenres).catch(() => {}), []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [load, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) loadGenres();
  }, [isAuthenticated, loadGenres]);

  const patch = (q: Partial<BookQuery>) => setQuery((prev) => ({ ...prev, ...q, page: q.page ?? 1 }));
  const changeView = (v: View | null) => {
    if (!v) return;
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const togglePtr = async (b: Book) => {
    try {
      const updated = await BookService.update(b.id, { planToRead: !b.planToRead });
      setData((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setToast({ severity: "error", text: errorText(e) });
    }
  };

  const open = (b: Book) => router.push(`/book/detail?id=${b.id}`);
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
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.015em" }}>Kitaplar</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>{loading ? "Yükleniyor…" : `${total} kitap`}</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEditing(null)}>Kitap ekle</Button>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => changeView(v)}>
            <ToggleButton value="grid" aria-label="Izgara"><GridViewRoundedIcon fontSize="small" /></ToggleButton>
            <ToggleButton value="table" aria-label="Tablo"><TableRowsRoundedIcon fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
        <TextField size="small" placeholder="Kitap, yazar ya da ISBN" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: { xs: 0, sm: 220 }, flex: { xs: "1 1 100%", sm: "1 1 220px" } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} />
        <TextField size="small" select label="Durumum" value={query.readStatus ?? ""} onChange={(e) => patch({ readStatus: e.target.value })} sx={filterSx}>
          <MenuItem value="">Hepsi</MenuItem>
          {Object.entries(BOOK_STATUS_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          <MenuItem value="NONE">Durum yok</MenuItem>
        </TextField>
        <TextField size="small" select label="Dil" value={query.language ?? ""} onChange={(e) => patch({ language: e.target.value })} sx={filterSx}>
          <MenuItem value="">Hepsi</MenuItem>
          {Object.entries(LANGUAGE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Tür" value={query.genres ?? []} onChange={(e) => patch({ genres: e.target.value as unknown as string[] })}
          SelectProps={{ multiple: true, renderValue: (v) => (v as string[]).join(", ") }} sx={{ ...filterSx, maxWidth: { sm: 260 } }}>
          {genres.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
        </TextField>
        <Chip label="Listemdekiler" variant={query.mine ? "filled" : "outlined"} color={query.mine ? "primary" : "default"} onClick={() => patch({ mine: !query.mine })} sx={{ alignSelf: "center" }} />
        <Chip label="Plan to Read" variant={query.ptr ? "filled" : "outlined"} color={query.ptr ? "primary" : "default"} onClick={() => patch({ ptr: !query.ptr })} sx={{ alignSelf: "center" }} />
        <SortMenu options={SORT_OPTIONS} sort={query.sort ?? "title"} order={query.order ?? "asc"} onChange={(sort, order) => patch({ sort, order })} />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Tekrar dene</Button>}>{error}</Alert>}
      {!isAuthenticated && <Alert severity="info" sx={{ mb: 2 }}>Kitap listesini görmek için giriş yap.</Alert>}

      {loading && !data.length ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2 }}>
          {showSkeleton && Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} variant="rounded" sx={{ aspectRatio: "2 / 3", height: "auto", borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />)}
        </Box>
      ) : !data.length && !error ? (
        <Box sx={{ textAlign: "center", py: 8, borderRadius: "16px", border: `1px dashed ${alpha(palette.overlay, 0.12)}` }}>
          <AutoStoriesOutlinedIcon sx={{ fontSize: 44, color: palette.primary, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Burada henüz kitap yok</Typography>
          <Button variant="contained" onClick={() => setEditing(null)}>Kitap ekle</Button>
        </Box>
      ) : view === "grid" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2, opacity: loading ? 0.6 : 1 }}>
          {data.map((b) => <BookCard key={b.id} b={b} onOpen={open} onEdit={setEditing} onTogglePtr={togglePtr} />)}
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
              {data.map((b) => (
                <TableRow key={b.id} hover sx={{ cursor: "pointer" }} onClick={() => open(b)}>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                      {b.cover && <img src={b.cover} alt="" loading="lazy" style={{ width: 32, height: 46, objectFit: "cover", borderRadius: 4 }} />}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: "0.85rem", fontWeight: 600 }}>{b.title}</Typography>
                        {b.subtitle && <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>{b.subtitle}</Typography>}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>{b.authors.join(", ") || "—"}</TableCell>
                  <TableCell>{yearOf(b.publishedDate) || "—"}</TableCell>
                  <TableCell><BookStatusChip status={b.readStatus} /></TableCell>
                  <TableCell align="right">{pagesText(b.pagesRead, b.pageCount)}</TableCell>
                  <TableCell align="right">{b.score || "—"}</TableCell>
                  <TableCell sx={{ minWidth: 180 }}><GenreChips genres={b.genres} max={3} justify="flex-start" /></TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <Box sx={{ display: "flex" }}>
                      <IconButton size="small" onClick={() => togglePtr(b)}>{b.planToRead ? <BookmarkRoundedIcon fontSize="small" /> : <BookmarkBorderRoundedIcon fontSize="small" />}</IconButton>
                      <IconButton size="small" onClick={() => setEditing(b)}><EditRoundedIcon fontSize="small" /></IconButton>
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

      <BookEditorDialog
        open={editing !== undefined}
        book={editing ?? null}
        isAdmin={isAdmin}
        onClose={() => setEditing(undefined)}
        onSaved={(b) => {
          setEditing(undefined);
          setToast({ severity: "success", text: `“${b.title}” kaydedildi` });
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
