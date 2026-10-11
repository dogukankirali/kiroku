"use client";

// Add / edit dialog for the manga section. Adding starts from an AniList search (type: MANGA, queried from
// the browser because AniList blocks Workers); a manual entry is possible too. Editing changes the user's
// own reading data; admins can also edit the shared catalog fields.

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { searchManga, type AniListManga } from "../../Services/anilist";
import { MangaService, errorText, fromAniList, type Manga, type MangaInput } from "../../Services/MangaService";
import { palette } from "../../theme/customTheme";
import { FORMAT_LABEL, PUB_STATUS_LABEL, READ_STATUS_LABEL } from "./mangaLabels";

type Props = {
  open: boolean;
  /** null = add a new manga */
  manga: Manga | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (m: Manga) => void;
};

const EMPTY: MangaInput = {
  name: "",
  englishName: "",
  status: "",
  format: "MANGA",
  totalChapters: 0,
  totalVolumes: 0,
  malScore: 0,
  genres: [],
  cover: "",
  score: 0,
  readStatus: "",
  chaptersRead: 0,
  volumesRead: 0,
  planToRead: false,
  notes: "",
  startedAt: "",
  finishedAt: "",
};

export default function MangaEditorDialog({ open, manga, isAdmin, onClose, onSaved }: Props) {
  const isNew = manga === null;
  const [form, setForm] = useState<MangaInput>(EMPTY);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AniListManga[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(manga ? { ...manga } : EMPTY);
    setPicked(!isNew);
    setShowCatalog(false);
    setResults([]);
    setSearch("");
    setError("");
  }, [open, manga, isNew]);

  // Debounced AniList search
  useEffect(() => {
    if (!isNew || picked || search.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchManga(search.trim(), ctrl.signal));
        setError("");
      } catch (e) {
        if (!ctrl.signal.aborted) setError(`AniList araması başarısız: ${errorText(e)}`);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [search, isNew, picked]);

  const set = <K extends keyof MangaInput>(k: K, v: MangaInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name?.trim()) return setError("Ad boş olamaz");
    setSaving(true);
    try {
      const payload: MangaInput = { ...form };
      // Non-admins never send catalog fields on edit (the Worker would ignore them anyway)
      if (!isNew && !isAdmin) {
        for (const k of ["name", "englishName", "status", "format", "totalChapters", "totalVolumes", "malScore", "genres", "cover", "anilistId", "malId", "malLink", "anilistLink", "seriesName"] as const) {
          delete payload[k];
        }
      }
      onSaved(isNew ? await MangaService.create(payload) : await MangaService.update(manga!.id, payload));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const catalog = (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
      <TextField label="Ad" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} required />
      <TextField label="İngilizce ad" value={form.englishName ?? ""} onChange={(e) => set("englishName", e.target.value)} />
      <TextField label="Seri" value={form.seriesName ?? ""} onChange={(e) => set("seriesName", e.target.value)} sx={{ gridColumn: { sm: "1 / -1" } }} />
      <TextField select label="Yayın durumu" value={form.status ?? ""} onChange={(e) => set("status", e.target.value)}>
        <MenuItem value="">—</MenuItem>
        {Object.entries(PUB_STATUS_LABEL).map(([k, v]) => (
          <MenuItem key={k} value={k}>{v}</MenuItem>
        ))}
      </TextField>
      <TextField select label="Biçim" value={form.format ?? ""} onChange={(e) => set("format", e.target.value)}>
        <MenuItem value="">—</MenuItem>
        {Object.entries(FORMAT_LABEL).map(([k, v]) => (
          <MenuItem key={k} value={k}>{v}</MenuItem>
        ))}
      </TextField>
      <TextField type="number" label="Toplam bölüm" value={form.totalChapters ?? 0} onChange={(e) => set("totalChapters", Number(e.target.value))} />
      <TextField type="number" label="Toplam cilt" value={form.totalVolumes ?? 0} onChange={(e) => set("totalVolumes", Number(e.target.value))} />
      <TextField type="number" label="Ortalama puan (0-10)" value={form.malScore ?? 0} onChange={(e) => set("malScore", Number(e.target.value))} inputProps={{ step: 0.1, min: 0, max: 10 }} />
      <TextField label="Türler (virgülle)" value={(form.genres ?? []).join(", ")} onChange={(e) => set("genres", e.target.value.split(",").map((g) => g.trim()).filter(Boolean))} />
      <TextField label="Kapak adresi" value={form.cover ?? ""} onChange={(e) => set("cover", e.target.value)} sx={{ gridColumn: { sm: "1 / -1" } }} />
      <TextField label="MAL bağlantısı" value={form.malLink ?? ""} onChange={(e) => set("malLink", e.target.value)} sx={{ gridColumn: { sm: "1 / -1" } }} />
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? "Manga ekle" : form.name}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {isNew && !picked && (
          <Box>
            <TextField autoFocus fullWidth label="AniList'te ara" value={search} onChange={(e) => setSearch(e.target.value)}
              InputProps={{ endAdornment: searching ? <CircularProgress size={18} /> : null }} />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1.5, maxHeight: 380, overflowY: "auto" }}>
              {results.map((r) => (
                <Box key={r.id} onClick={() => { setForm((f) => ({ ...f, ...fromAniList(r) })); setPicked(true); }}
                  sx={{ display: "flex", gap: 1.5, p: 1, borderRadius: "10px", cursor: "pointer", border: `1px solid ${alpha(palette.overlay, 0.08)}`, "&:hover": { backgroundColor: palette.surfaceRaised } }}>
                  {r.coverImage?.large && <img src={r.coverImage.large} alt="" style={{ width: 44, height: 62, objectFit: "cover", borderRadius: 6 }} />}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 600 }}>{r.title.romaji ?? r.title.english}</Typography>
                    <Typography noWrap sx={{ fontSize: "0.78rem", color: palette.textMuted }}>
                      {[r.title.english, FORMAT_LABEL[r.format ?? ""] ?? r.format, r.chapters ? `${r.chapters} bölüm` : null, PUB_STATUS_LABEL[r.status ?? ""]].filter(Boolean).join(" · ")}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
            <Button sx={{ mt: 1.5 }} onClick={() => { setForm({ ...EMPTY, name: search }); setPicked(true); setShowCatalog(true); }}>
              Elle gir
            </Button>
          </Box>
        )}

        {picked && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {(isNew || isAdmin) && (
              <>
                <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                  {form.cover && <img src={form.cover} alt="" style={{ width: 56, height: 80, objectFit: "cover", borderRadius: 8 }} />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{form.name}</Typography>
                    <Typography sx={{ fontSize: "0.78rem", color: palette.textMuted }}>
                      {[form.englishName, form.totalChapters ? `${form.totalChapters} bölüm` : null, PUB_STATUS_LABEL[form.status ?? ""]].filter(Boolean).join(" · ")}
                    </Typography>
                  </Box>
                  <Button size="small" onClick={() => setShowCatalog((s) => !s)}>{showCatalog ? "Gizle" : "Katalog bilgisi"}</Button>
                </Box>
                <Collapse in={showCatalog}>{catalog}</Collapse>
              </>
            )}

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mt: 1 }}>
              <TextField select label="Okuma durumu" value={form.readStatus ?? ""} onChange={(e) => set("readStatus", e.target.value as MangaInput["readStatus"])}>
                <MenuItem value="">—</MenuItem>
                {Object.entries(READ_STATUS_LABEL).map(([k, v]) => (
                  <MenuItem key={k} value={k}>{v}</MenuItem>
                ))}
              </TextField>
              <TextField type="number" label="Puanım (0-10)" value={form.score ?? 0} onChange={(e) => set("score", Number(e.target.value))} inputProps={{ step: 0.5, min: 0, max: 10 }} />
              <TextField type="number" label={`Okunan bölüm${form.totalChapters ? ` / ${form.totalChapters}` : ""}`} value={form.chaptersRead ?? 0}
                onChange={(e) => set("chaptersRead", Math.max(0, Number(e.target.value)))} />
              <TextField type="number" label={`Okunan cilt${form.totalVolumes ? ` / ${form.totalVolumes}` : ""}`} value={form.volumesRead ?? 0}
                onChange={(e) => set("volumesRead", Math.max(0, Number(e.target.value)))} />
              <TextField type="date" label="Başlama" InputLabelProps={{ shrink: true }} value={form.startedAt ?? ""} onChange={(e) => set("startedAt", e.target.value)} />
              <TextField type="date" label="Bitiş" InputLabelProps={{ shrink: true }} value={form.finishedAt ?? ""} onChange={(e) => set("finishedAt", e.target.value)} />
            </Box>
            <FormControlLabel control={<Checkbox checked={Boolean(form.planToRead)} onChange={(e) => set("planToRead", e.target.checked)} />} label="Plan to Read (okuma listeme ekle)" />
            <TextField label="Notlar" multiline minRows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {isNew && picked && <Button onClick={() => setPicked(false)}>Geri</Button>}
        <Button onClick={onClose}>Vazgeç</Button>
        <Button variant="contained" disabled={!picked || saving} onClick={save}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
