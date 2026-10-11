"use client";

// Salon (/salon?id=<anime>&ep=<bölüm>): animenin kendi video kütüphanendeki klasöründen bölümleri oynatır.
// Klasör adı animenin adıyla eşleşirse kendiliğinden bulunur, eşleşmezse bir kez seçilir (tarayıcıda hatırlanır).
// Bölümün %90'ı izlenince Kiroku'daki ilerleme (izlenen bölüm) güncellenir; kalınan saniye bölüm başına saklanır.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, CircularProgress, MenuItem, Snackbar, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { AnimeService } from "../../Services/AnimeServices";
import { palette } from "../../theme/customTheme";
import SalonPlayer from "../../components/salon/SalonPlayer";
import {
  Episode,
  VideoLibraryConfig,
  VideoLibraryError,
  canPickFolder,
  listEpisodes,
  listVideoLibrary,
  loadVideoLibrary,
  localFolderName,
  matchFolder,
  pickVideoFolder,
  saveFolder,
  saveVideoLibrary,
  subtitleUrl,
  videoUrl,
} from "../../lib/videoLibrary";

const card = { p: { xs: 2, md: 2.5 }, borderRadius: "16px", backgroundColor: palette.surface, border: `1px solid ${alpha(palette.overlay, 0.06)}` };
const posKey = (animeId: number, file: string) => `kirokuSalonPos:${animeId}:${file}`;
const WATCHED_AT = 0.9;

function readPos(key: string) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function writePos(key: string, seconds: number | null) {
  try {
    if (seconds === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.floor(seconds)));
  } catch {}
}

/** Video kütüphanesi ayarı: HTTP sunucu (adres + isteğe bağlı erişim anahtarı) ya da bu sekmede seçilen klasör */
function LibrarySettings({ error, onSaved }: { error?: string; onSaved: () => void }) {
  const [cfg, setCfg] = useState<VideoLibraryConfig>(() => loadVideoLibrary());
  const save = (next = cfg) => {
    saveVideoLibrary(next);
    onSaved();
  };
  return (
    <Box sx={{ ...card, display: "grid", gap: 2, maxWidth: 640 }}>
      <Typography sx={{ fontWeight: 700 }}>Video kütüphanesi</Typography>
      <Typography sx={{ fontSize: "0.85rem", color: palette.textMuted }}>
        Salon bölümleri kendi kütüphanenden açar; Kiroku yalnızca ilerlemeyi tutar. Her anime için bir klasör, içinde bölüm dosyaları (MP4/WebM, isteğe bağlı aynı adlı
        .vtt/.srt altyazı) olmalı. Bu ayar yalnızca bu tarayıcıda saklanır.
      </Typography>
      {error ? (
        <Alert severity="warning" sx={{ borderRadius: "12px" }}>
          {error}
        </Alert>
      ) : null}
      <ToggleButtonGroup exclusive size="small" value={cfg.kind} onChange={(_, kind) => kind && setCfg({ ...cfg, kind })}>
        <ToggleButton value="http">Sunucu (HTTP)</ToggleButton>
        <ToggleButton value="local">Bilgisayardaki klasör</ToggleButton>
      </ToggleButtonGroup>
      {cfg.kind === "http" ? (
        <>
          <TextField
            size="small"
            label="Adres"
            placeholder="http://localhost:8789"
            value={cfg.url}
            onChange={(e) => setCfg({ ...cfg, url: e.target.value.trim() })}
            helperText="Yerelde: node scripts/manga-library.mjs <anime klasörü> --port 8789"
          />
          <TextField size="small" label="Erişim anahtarı (isteğe bağlı)" type="password" value={cfg.key} onChange={(e) => setCfg({ ...cfg, key: e.target.value })} />
          <Box>
            <Button variant="contained" onClick={() => save()} disabled={!cfg.url}>
              Kaydet
            </Button>
          </Box>
        </>
      ) : (
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            variant="contained"
            startIcon={<FolderOpenRoundedIcon />}
            disabled={!canPickFolder()}
            onClick={async () => {
              try {
                await pickVideoFolder();
                save({ ...cfg, kind: "local" });
              } catch {}
            }}
          >
            Klasör seç
          </Button>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>
            {canPickFolder() ? "Seçim yalnızca bu sekme açıkken geçerli." : "Bu tarayıcı klasör seçmeyi desteklemiyor (Chrome ya da Edge gerekir)."}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function Salon() {
  const params = useSearchParams();
  const router = useRouter();
  const id = Number(params.get("id"));
  const epParam = params.get("ep");

  const [anime, setAnime] = useState<TEATable.IAnime | null>(null);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [libError, setLibError] = useState<VideoLibraryError | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [media, setMedia] = useState<{ src: string; sub: string | null } | null>(null);
  const [theater, setTheater] = useState(false);
  const [toast, setToast] = useState("");
  const [folderQuery, setFolderQuery] = useState("");
  const markedRef = useRef<string>("");
  const lastSave = useRef(0);

  useEffect(() => {
    if (!id) return setError("Geçersiz anime");
    AnimeService.getAnime(id)
      .then((res: any) => setAnime(res.data.data))
      .catch((err: any) => setError(err?.response?.status === 404 ? "Anime bulunamadı" : "Anime yüklenemedi"));
  }, [id]);

  // Kütüphanedeki klasörler ve bu animenin klasörü
  useEffect(() => {
    if (!anime) return;
    let alive = true;
    setLibError(null);
    setFolders(null);
    const cfg = loadVideoLibrary();
    if (cfg.kind === "http" ? !cfg.url : !localFolderName()) {
      setLibError(new VideoLibraryError(cfg.kind === "http" ? "" : "Bu sekmede video klasörü henüz seçilmedi", cfg.kind === "http" ? "config" : "pick"));
      return;
    }
    listVideoLibrary("")
      .then((entries) => {
        if (!alive) return;
        const dirs = entries.filter((e) => e.isDir).map((e) => e.name).sort((a, b) => a.localeCompare(b, "tr"));
        setFolders(dirs);
        setFolder(matchFolder(anime.ID, [String(anime.Name), String(anime.EnglishName ?? "")], dirs));
      })
      .catch((e) => alive && setLibError(e instanceof VideoLibraryError ? e : new VideoLibraryError(String(e?.message ?? e), "config")));
    return () => {
      alive = false;
    };
  }, [anime, reload]);

  useEffect(() => {
    if (!folder) return setEpisodes(null);
    let alive = true;
    setEpisodes(null);
    listEpisodes(folder)
      .then((eps) => alive && setEpisodes(eps))
      .catch((e) => alive && setLibError(e instanceof VideoLibraryError ? e : new VideoLibraryError(String(e?.message ?? e), "config")));
    return () => {
      alive = false;
    };
  }, [folder]);

  const watched = Number(anime?.WatchStatus ?? 0);
  const current = useMemo(() => {
    if (!episodes?.length) return null;
    if (epParam !== null) return episodes.find((e) => String(e.number) === epParam) ?? episodes.find((e) => e.file.endsWith(`/${epParam}`)) ?? episodes[0];
    return episodes.find((e) => e.number > watched) ?? episodes[episodes.length - 1];
  }, [episodes, epParam, watched]);
  const idx = current && episodes ? episodes.indexOf(current) : -1;
  const prev = idx > 0 ? episodes![idx - 1] : null;
  const next = idx >= 0 && episodes && idx < episodes.length - 1 ? episodes[idx + 1] : null;

  const go = useCallback((ep: Episode) => router.replace(`/salon?id=${id}&ep=${encodeURIComponent(ep.number ? String(ep.number) : ep.file.split("/").pop()!)}`), [router, id]);

  // Seçili bölümün oynatılabilir adresi (yerel klasörde blob URL, kapanınca bırakılır)
  useEffect(() => {
    if (!current) return setMedia(null);
    let alive = true;
    const revokers: (() => void)[] = [];
    markedRef.current = "";
    setMedia(null);
    (async () => {
      try {
        const v = await videoUrl(current.file);
        revokers.push(v.revoke);
        let sub: string | null = null;
        if (current.subtitle) {
          const s = await subtitleUrl(current.subtitle).catch(() => null);
          if (s) {
            revokers.push(s.revoke);
            sub = s.url;
          }
        }
        if (alive) setMedia({ src: v.url, sub });
      } catch (e) {
        if (alive) setLibError(e instanceof VideoLibraryError ? e : new VideoLibraryError(String((e as Error)?.message ?? e), "missing"));
      }
    })();
    return () => {
      alive = false;
      revokers.forEach((r) => r());
    };
  }, [current]);

  const markWatched = useCallback(
    async (ep: Episode) => {
      if (!anime || !ep.number || markedRef.current === ep.file) return;
      markedRef.current = ep.file;
      if (ep.number <= Number(anime.WatchStatus ?? 0)) return;
      const total = Number(anime.TotalNumberOfEpisodes) || 0;
      const updated = { ...anime, WatchStatus: total ? Math.min(ep.number, total) : ep.number };
      try {
        await AnimeService.updateAnime(updated);
        setAnime(updated);
        setToast(`${ep.number}. bölüm izlendi olarak kaydedildi`);
      } catch {
        markedRef.current = "";
        setToast("İlerleme kaydedilemedi");
      }
    },
    [anime]
  );

  const onProgress = useCallback(
    (time: number, duration: number) => {
      if (!current || !duration) return;
      if (time / duration >= WATCHED_AT) {
        writePos(posKey(id, current.file), null);
        markWatched(current);
      } else if (Date.now() - lastSave.current > 4000) {
        lastSave.current = Date.now();
        writePos(posKey(id, current.file), time);
      }
    },
    [current, id, markWatched]
  );

  if (error) {
    return (
      <Alert severity="error" sx={{ borderRadius: "12px", maxWidth: 900, mx: "auto" }}>
        {error}
      </Alert>
    );
  }

  const shownFolders = (folders ?? []).filter((f) => f.toLocaleLowerCase("tr").includes(folderQuery.toLocaleLowerCase("tr"))).slice(0, 60);

  return (
    <Box sx={{ maxWidth: theater ? "none" : 1400, mx: "auto", display: "grid", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Button component={Link} href={id ? `/anime/detail?id=${id}` : "/anime"} startIcon={<ArrowBackRoundedIcon />} sx={{ color: palette.textMuted }}>
          {anime ? String(anime.Name) : "Anime"}
        </Button>
        <Typography sx={{ fontWeight: 800, fontSize: "1.1rem", ml: "auto" }}>Salon</Typography>
      </Box>

      {!anime ? <CircularProgress sx={{ mx: "auto" }} /> : null}

      {anime && libError ? (
        <LibrarySettings
          error={libError.message || undefined}
          onSaved={() => {
            setLibError(null);
            setReload((r) => r + 1);
          }}
        />
      ) : null}

      {anime && !libError && folders && !folder ? (
        <Box sx={{ ...card, display: "grid", gap: 1.5, maxWidth: 640 }}>
          <Typography sx={{ fontWeight: 700 }}>Bu animenin klasörünü seç</Typography>
          <Typography sx={{ fontSize: "0.85rem", color: palette.textMuted }}>
            Kütüphanende &quot;{String(anime.Name)}&quot; adlı bir klasör bulunamadı. Seçimin bu tarayıcıda hatırlanır.
          </Typography>
          <TextField size="small" placeholder="Klasör ara…" value={folderQuery} onChange={(e) => setFolderQuery(e.target.value)} />
          <Box sx={{ maxHeight: 360, overflow: "auto", display: "grid" }}>
            {shownFolders.map((f) => (
              <MenuItem
                key={f}
                onClick={() => {
                  saveFolder(anime.ID, f);
                  setFolder(f);
                }}
              >
                {f}
              </MenuItem>
            ))}
            {!shownFolders.length ? <Typography sx={{ color: palette.textMuted, p: 1 }}>Klasör yok</Typography> : null}
          </Box>
          <Box>
            <Button size="small" onClick={() => setLibError(new VideoLibraryError("", "config"))}>
              Kütüphane ayarı
            </Button>
          </Box>
        </Box>
      ) : null}

      {anime && folder && episodes && !episodes.length ? (
        <Alert severity="info" sx={{ borderRadius: "12px" }} action={<Button onClick={() => (saveFolder(anime.ID, null), setFolder(null))}>Başka klasör</Button>}>
          &quot;{folder}&quot; klasöründe video dosyası yok.
        </Alert>
      ) : null}

      {anime && current ? (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: theater ? "1fr" : "minmax(0, 1fr) 320px" }, gap: 2, alignItems: "start" }}>
          <Box sx={{ mx: theater ? { xs: -1.5, sm: -2, md: -3 } : 0 }}>
            {media ? (
              <SalonPlayer
                key={current.file}
                src={media.src}
                subtitle={media.sub}
                title={`${String(anime.Name)} · ${current.label}`}
                startAt={readPos(posKey(id, current.file))}
                theater={theater}
                onTheaterChange={setTheater}
                onProgress={onProgress}
                onEnded={() => {
                  markWatched(current);
                  if (next) go(next);
                }}
                onPrev={prev ? () => go(prev) : null}
                onNext={next ? () => go(next) : null}
              />
            ) : (
              <Box sx={{ aspectRatio: "16/9", borderRadius: "14px", backgroundColor: "#000", display: "grid", placeItems: "center" }}>
                <CircularProgress />
              </Box>
            )}
            <Typography sx={{ mt: 1.5, fontWeight: 700 }}>
              {current.label}
              <Typography component="span" sx={{ ml: 1, color: palette.textMuted, fontSize: "0.8rem", fontWeight: 400 }}>
                {current.file.split("/").pop()}
              </Typography>
            </Typography>
          </Box>

          <Box sx={{ ...card, p: 1.5, maxHeight: { lg: "calc(100vh - 160px)" }, overflow: "auto" }}>
            <Box sx={{ display: "flex", alignItems: "center", px: 1, pb: 1 }}>
              <Typography sx={{ fontWeight: 700, flex: 1 }}>Bölümler</Typography>
              <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>
                {watched}/{anime.TotalNumberOfEpisodes || "?"} izlendi
              </Typography>
            </Box>
            {episodes!.map((ep) => {
              const active = ep === current;
              const seen = ep.number > 0 && ep.number <= watched;
              return (
                <MenuItem key={ep.file} selected={active} onClick={() => go(ep)} sx={{ borderRadius: "10px", gap: 1, color: seen && !active ? palette.textMuted : undefined }}>
                  {active ? <PlayArrowRoundedIcon fontSize="small" sx={{ color: palette.primary }} /> : seen ? <CheckCircleRoundedIcon fontSize="small" sx={{ color: palette.success }} /> : <Box sx={{ width: 20 }} />}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: "0.9rem", fontWeight: active ? 700 : 500 }}>{ep.label}</Typography>
                    <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.file.split("/").pop()}</Typography>
                  </Box>
                </MenuItem>
              );
            })}
            <Button size="small" sx={{ mt: 1 }} onClick={() => (saveFolder(anime.ID, null), setFolder(null))}>
              Klasörü değiştir
            </Button>
          </Box>
        </Box>
      ) : null}

      <Snackbar open={Boolean(toast)} autoHideDuration={3000} onClose={() => setToast("")} message={toast} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />
    </Box>
  );
}

export default function SalonPage() {
  return (
    <Suspense fallback={null}>
      <Salon />
    </Suspense>
  );
}
