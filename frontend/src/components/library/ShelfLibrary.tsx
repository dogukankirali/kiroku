"use client";

// Kitaplığım (/library): elindeki fiziksel kitap ve manga ciltlerini seri bazında takip eder.

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Skeleton,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import CollectionsBookmarkOutlinedIcon from "@mui/icons-material/CollectionsBookmarkOutlined";
import { palette } from "../../theme/customTheme";
import { useAuth } from "../../contexts/AuthContext";
import {
  LibraryService,
  errorText,
  parseVolumeRange,
  type ShelfKind,
  type ShelfSeries,
  type ShelfSeriesDetail,
} from "../../Services/LibraryService";

type Toast = { severity: "success" | "error"; text: string } | null;
const KIND_LABEL: Record<ShelfKind, string> = { manga: "Manga", book: "Kitap" };

function SeriesCard({ s, onOpen }: { s: ShelfSeries; onOpen: () => void }) {
  const total = s.totalVolumes || s.maxVolume;
  const pct = total ? Math.min(100, (s.ownedCount / total) * 100) : 0;
  return (
    <Box
      onClick={onOpen}
      sx={{
        cursor: "pointer",
        borderRadius: "14px",
        overflow: "hidden",
        backgroundColor: palette.surface,
        border: `1px solid ${alpha(palette.overlay, 0.06)}`,
        "&:hover": { backgroundColor: palette.surfaceRaised },
      }}
    >
      <Box sx={{ aspectRatio: "2 / 3", backgroundColor: palette.surfaceRaised, display: "grid", placeItems: "center" }}>
        {s.cover ? (
          <img src={s.cover} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <CollectionsBookmarkOutlinedIcon sx={{ fontSize: 40, color: palette.textFaint }} />
        )}
      </Box>
      <Box sx={{ p: 1.25 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{s.title}</Typography>
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", my: 0.5, flexWrap: "wrap" }}>
          <Chip size="small" label={KIND_LABEL[s.kind]} sx={{ height: 20, fontSize: "0.68rem" }} />
          <Typography sx={{ fontSize: "0.75rem", color: palette.textMuted }}>
            {s.ownedCount}{total ? ` / ${total}` : ""} cilt
          </Typography>
          {s.wantedCount > 0 && <Chip size="small" label={`${s.wantedCount} istek`} sx={{ height: 20, fontSize: "0.68rem", color: palette.warning, backgroundColor: alpha(palette.warning, 0.14) }} />}
        </Box>
        {total > 0 && <LinearProgress variant="determinate" value={pct} sx={{ height: 4, borderRadius: 2, backgroundColor: alpha(palette.overlay, 0.06) }} />}
      </Box>
    </Box>
  );
}

function SeriesDialog({ id, onClose, onChanged, notify }: { id: number | "new"; onClose: () => void; onChanged: () => void; notify: (t: Toast) => void }) {
  const isNew = id === "new";
  const [series, setSeries] = useState<ShelfSeriesDetail | null>(null);
  const [form, setForm] = useState({ title: "", kind: "manga" as ShelfKind, totalVolumes: "", cover: "", notes: "" });
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (s: ShelfSeriesDetail) => {
    setSeries(s);
    setForm({ title: s.title, kind: s.kind, totalVolumes: s.totalVolumes ? String(s.totalVolumes) : "", cover: s.cover, notes: s.notes });
  };

  useEffect(() => {
    if (!isNew) LibraryService.get(id).then(apply).catch((e) => notify({ severity: "error", text: errorText(e) }));
  }, [id, isNew]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { title: form.title, kind: form.kind, totalVolumes: Number(form.totalVolumes) || 0, cover: form.cover, notes: form.notes };
      const saved = isNew ? await LibraryService.create(payload) : await LibraryService.update(id, payload);
      apply(saved);
      onChanged();
      if (isNew) notify({ severity: "success", text: "Seri eklendi, şimdi ciltlerini işaretleyebilirsin" });
    } catch (e) {
      notify({ severity: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const setNumbers = async (numbers: number[], state: "owned" | "wanted") => {
    if (!series || !numbers.length) return;
    try {
      apply(await LibraryService.setVolumes(series.id, numbers, state));
      onChanged();
    } catch (e) {
      notify({ severity: "error", text: errorText(e) });
    }
  };

  // Boş → sahip → istek → boş
  const cycle = async (n: number) => {
    if (!series) return;
    const vols = series.volumes.filter((v) => v.number === n);
    const state = vols.some((v) => v.owned) ? "owned" : vols.some((v) => v.wanted) ? "wanted" : "none";
    try {
      if (state === "none") return setNumbers([n], "owned");
      if (state === "owned") return setNumbers([n], "wanted");
      await Promise.all(vols.map((v) => LibraryService.removeVolume(v.id)));
      apply(await LibraryService.get(series.id));
      onChanged();
    } catch (e) {
      notify({ severity: "error", text: errorText(e) });
    }
  };

  const removeSeries = async () => {
    if (!series || !window.confirm(`“${series.title}” ve ciltleri silinsin mi?`)) return;
    await LibraryService.remove(series.id);
    onChanged();
    onClose();
  };

  const slots = series ? Math.max(series.totalVolumes, series.maxVolume) : 0;
  const stateOf = (n: number) => {
    const vols = series?.volumes.filter((v) => v.number === n) ?? [];
    return vols.some((v) => v.owned) ? "owned" : vols.some((v) => v.wanted) ? "wanted" : "none";
  };
  const numbers = parseVolumeRange(range);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{isNew && !series ? "Yeni seri" : form.title || "Seri"}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "2fr 1fr 1fr" }, mb: 2 }}>
          <TextField size="small" label="Seri adı" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <TextField size="small" select SelectProps={{ native: true }} label="Tür" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ShelfKind })}>
            <option value="manga">Manga</option>
            <option value="book">Kitap</option>
          </TextField>
          <TextField size="small" label="Toplam cilt" type="number" value={form.totalVolumes} onChange={(e) => setForm({ ...form, totalVolumes: e.target.value })} helperText="Bilinmiyorsa boş" />
          <TextField size="small" label="Kapak bağlantısı" value={form.cover} onChange={(e) => setForm({ ...form, cover: e.target.value })} sx={{ gridColumn: { sm: "1 / 3" } }} />
          <TextField size="small" label="Not" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Box>

        {series && (
          <>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Ciltler</Typography>
            <Typography sx={{ fontSize: "0.78rem", color: palette.textMuted, mb: 1.25 }}>
              Kutuya tıkla: boş → sende var → istiyorum → boş. {series.ownedCount} cilt sende
              {series.wantedCount ? `, ${series.wantedCount} cilt istek listesinde` : ""}.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(46px, 1fr))", gap: 0.75, mb: 2 }}>
              {Array.from({ length: slots }, (_, i) => i + 1).map((n) => {
                const st = stateOf(n);
                const color = st === "owned" ? palette.success : st === "wanted" ? palette.warning : palette.textFaint;
                return (
                  <Box
                    key={n}
                    onClick={() => cycle(n)}
                    role="button"
                    aria-label={`Cilt ${n}`}
                    sx={{
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      py: 0.9,
                      borderRadius: "8px",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      color: st === "owned" ? "#fff" : color,
                      backgroundColor: st === "owned" ? alpha(palette.success, 0.55) : "transparent",
                      border: `1px ${st === "wanted" ? "dashed" : "solid"} ${alpha(color, st === "none" ? 0.3 : 0.9)}`,
                    }}
                  >
                    {n}
                  </Box>
                );
              })}
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-start" }}>
              <TextField
                size="small"
                label="Cilt aralığı"
                placeholder="1-12, 14"
                value={range}
                onChange={(e) => setRange(e.target.value)}
                helperText={numbers.length ? `${numbers.length} cilt` : "Örn. 1-12, 14"}
                sx={{ flex: "1 1 200px" }}
              />
              <Button variant="outlined" disabled={!numbers.length} onClick={() => setNumbers(numbers, "owned").then(() => setRange(""))}>Sende var olarak ekle</Button>
              <Button variant="outlined" color="warning" disabled={!numbers.length} onClick={() => setNumbers(numbers, "wanted").then(() => setRange(""))}>İstek listesine ekle</Button>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        {series ? (
          <Tooltip title="Seriyi sil">
            <IconButton onClick={removeSeries} sx={{ color: palette.danger }}><DeleteOutlineRoundedIcon /></IconButton>
          </Tooltip>
        ) : <span />}
        <Box>
          <Button onClick={onClose}>Kapat</Button>
          <Button variant="contained" onClick={save} disabled={busy || !form.title.trim()} sx={{ ml: 1 }}>{series ? "Kaydet" : "Ekle"}</Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

export default function ShelfLibrary() {
  const { isAuthenticated } = useAuth();
  const [kind, setKind] = useState<"" | ShelfKind>("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ShelfSeries[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | "new" | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setItems(await LibraryService.list({ kind: kind || undefined, q: q || undefined }));
      setError("");
    } catch (e) {
      setError(errorText(e, "Kitaplık alınamadı"));
      setItems([]);
    }
  }, [kind, q]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [load, isAuthenticated]);

  if (!isAuthenticated) return <Alert severity="info">Kitaplığını görmek için giriş yapmalısın.</Alert>;

  const totalOwned = (items ?? []).reduce((n, s) => n + s.ownedCount, 0);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.015em" }}>Kitaplığım</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>
            {items === null ? "Yükleniyor…" : `${items.length} seri · ${totalOwned} cilt`}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setOpen("new")}>Yeni seri</Button>
      </Box>

      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap", mb: 2 }}>
        <Tabs value={kind} onChange={(_, v) => setKind(v)} sx={{ minHeight: 40 }}>
          <Tab value="" label="Hepsi" sx={{ minHeight: 40 }} />
          <Tab value="manga" label="Manga" sx={{ minHeight: 40 }} />
          <Tab value="book" label="Kitap" sx={{ minHeight: 40 }} />
        </Tabs>
        <TextField
          size="small"
          placeholder="Seri ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 220 }}
        />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {items === null ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2 }}>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} variant="rounded" sx={{ aspectRatio: "2 / 3", height: "auto", borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />)}
        </Box>
      ) : items.length === 0 && !error ? (
        <Box sx={{ textAlign: "center", py: 8, borderRadius: "16px", border: `1px dashed ${alpha(palette.overlay, 0.12)}` }}>
          <CollectionsBookmarkOutlinedIcon sx={{ fontSize: 44, color: palette.primary, mb: 1.5 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Kitaplığın boş</Typography>
          <Typography sx={{ color: palette.textMuted, fontSize: "0.875rem", mb: 2 }}>Bir seri ekle, sonra elindeki ciltleri işaretle.</Typography>
          <Button variant="contained" onClick={() => setOpen("new")}>İlk seriyi ekle</Button>
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2 }}>
          {items.map((s) => <SeriesCard key={s.id} s={s} onOpen={() => setOpen(s.id)} />)}
        </Box>
      )}

      {open !== null && <SeriesDialog id={open} onClose={() => setOpen(null)} onChanged={load} notify={setToast} />}

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {toast ? <Alert onClose={() => setToast(null)} severity={toast.severity} variant="filled">{toast.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
