"use client";

// Altyazı bul: kütüphane sunucusu (--writable) podnapisi/OpenSubtitles'ta arar ve seçilen altyazıyı bölümün videosunun yanına kaydeder.
// Anahtarlar sunucuda durur; tarayıcıya yalnızca sonuç listesi gelir.

import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, MenuItem, TextField, Typography } from "@mui/material";
import { palette } from "../../theme/customTheme";
import { SubtitleHit, SubtitleInfo, saveSubtitleFile, searchSubtitles } from "../../lib/videoLibrary";

const LANGS = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "İngilizce" },
  { code: "ja", label: "Japonca" },
  { code: "de", label: "Almanca" },
  { code: "fr", label: "Fransızca" },
  { code: "es", label: "İspanyolca" },
  { code: "pt", label: "Portekizce" },
  { code: "ru", label: "Rusça" },
];
const PROVIDER_LABEL: Record<string, string> = { podnapisi: "Podnapisi (anahtarsız)", opensubtitles: "OpenSubtitles" };

type Props = {
  open: boolean;
  onClose: () => void;
  info: SubtitleInfo;
  /** Kütüphane yolu: 'Klasör/Dosya.mkv' */
  file: string;
  names: string[];
  episode: number;
  onSaved: (fileName: string) => void;
};

export default function SubtitleFinder({ open, onClose, info, file, names, episode, onSaved }: Props) {
  const [lang, setLang] = useState("tr");
  const [provider, setProvider] = useState(info.providers[0] ?? "podnapisi");
  const [query, setQuery] = useState(names[0] ?? "");
  const [ep, setEp] = useState(episode ? String(episode) : "");
  const [season, setSeason] = useState("");
  const [hits, setHits] = useState<SubtitleHit[] | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  // Başka bölüme geçilince alanlar o bölüme göre yenilenir
  useEffect(() => {
    setEp(episode ? String(episode) : "");
    setHits(null);
    setError("");
  }, [episode, file]);

  const search = async () => {
    setBusy("search");
    setError("");
    try {
      setHits(await searchSubtitles({ provider, q: query.trim(), lang, season: season.trim(), episode: ep.trim() }));
    } catch (e) {
      setHits(null);
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const save = async (hit: SubtitleHit) => {
    setBusy(hit.id);
    setError("");
    try {
      const saved = await saveSubtitleFile({ provider: hit.provider, id: hit.id, lang, file });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Altyazı bul</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 1.5, pt: "8px !important" }}>
        {!info.writable ? (
          <Alert severity="warning" sx={{ borderRadius: "12px" }}>
            Sunucu <code>--writable</code> ile başlatılmadığı için altyazı videonun yanına kaydedilemez.
          </Alert>
        ) : null}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
          <TextField select size="small" label="Dil" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => (
              <MenuItem key={l.code} value={l.code}>
                {l.label}
              </MenuItem>
            ))}
          </TextField>
          {info.providers.length > 1 ? (
            <TextField select size="small" label="Kaynak" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {info.providers.map((p) => (
                <MenuItem key={p} value={p}>
                  {PROVIDER_LABEL[p] ?? p}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography sx={{ alignSelf: "center", fontSize: "0.85rem", color: palette.textMuted }}>Kaynak: {PROVIDER_LABEL[provider] ?? provider}</Typography>
          )}
        </Box>
        <TextField size="small" label="Ad" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query.trim() && search()} />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 1.5 }}>
          <TextField size="small" label="Sezon (isteğe bağlı)" value={season} onChange={(e) => setSeason(e.target.value.replace(/\D/g, ""))} />
          <TextField size="small" label="Bölüm" value={ep} onChange={(e) => setEp(e.target.value.replace(/\D/g, ""))} />
          <Button variant="contained" onClick={search} disabled={!query.trim() || busy === "search"}>
            {busy === "search" ? <CircularProgress size={20} /> : "Ara"}
          </Button>
        </Box>
        {error ? (
          <Alert severity="error" sx={{ borderRadius: "12px" }}>
            {error}
          </Alert>
        ) : null}
        {hits && !hits.length ? <Typography sx={{ color: palette.textMuted, fontSize: "0.9rem" }}>Sonuç yok. Adı kısaltmayı ya da bölüm alanını boşaltmayı dene.</Typography> : null}
        <Box sx={{ display: "grid", maxHeight: 340, overflow: "auto" }}>
          {(hits ?? []).map((h) => (
            <MenuItem key={`${h.provider}:${h.id}`} onClick={() => !busy && info.writable && save(h)} disabled={!info.writable || Boolean(busy)} sx={{ gap: 1, whiteSpace: "normal", alignItems: "flex-start" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: "0.9rem", wordBreak: "break-word" }}>{h.name || h.id}</Typography>
                <Typography sx={{ fontSize: "0.75rem", color: palette.textMuted }}>{h.downloads} indirme</Typography>
              </Box>
              {busy === h.id ? <CircularProgress size={18} /> : <Typography sx={{ color: palette.primary, fontSize: "0.85rem", fontWeight: 600 }}>İndir</Typography>}
            </MenuItem>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
