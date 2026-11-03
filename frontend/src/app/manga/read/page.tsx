"use client";

// Manga reader (/manga/read?id=<manga>&ch=<chapter>): vertical (webtoon) or paged mode, right-to-left
// option, fit width/height, keyboard and tap navigation, preloading, previous/next chapter. Finishing a
// chapter saves user_manga.chapters_read; the page position is remembered per chapter for resuming.

import { stateGetJson, stateSetJson, stateSync } from "../../../lib/userState";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, CircularProgress, IconButton, MenuItem, Select, Slider, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import NavigateBeforeRoundedIcon from "@mui/icons-material/NavigateBeforeRounded";
import NavigateNextRoundedIcon from "@mui/icons-material/NavigateNextRounded";
import ViewDayRoundedIcon from "@mui/icons-material/ViewDayRounded";
import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import SwapHorizRoundedIcon from "@mui/icons-material/SwapHorizRounded";
import FitScreenRoundedIcon from "@mui/icons-material/FitScreenRounded";
import { ChapterService, MangaService, errorText, type Chapter, type Manga } from "../../../Services/MangaService";
import { cbzSource, pageSource, preload, type PageSource } from "../../../lib/chapterPages";
import { LibraryError, canPickFolder, pickLocalFolder } from "../../../lib/library";
import { chapterLabel } from "../../../components/manga/mangaLabels";

type Mode = "vertical" | "paged";
type Fit = "width" | "height";
type Settings = { mode: Mode; rtl: boolean; fit: Fit };

const SETTINGS_KEY = "read.settings"; // synced to the account ("kirokuReader" is the old per-browser copy)
const posKey = (chId: number) => `read.pos:${chId}`;
const contKey = (mangaId: number) => `read.cont:${mangaId}`;

// Account-synced reader state is pulled once per page load (max 1.5 s) before positions are read
let readSync: Promise<void> | null = null;
const ensureSynced = () => (readSync ??= Promise.race([stateSync("read."), new Promise((r) => setTimeout(r, 1500))]).then(() => undefined));
const DEFAULTS: Settings = { mode: "vertical", rtl: false, fit: "width" };

function readStore<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function PageImg({ src, i, fit, mode, onLoad }: { src: PageSource; i: number; fit: Fit; mode: Mode; onLoad?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const triedFallback = useRef(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    triedFallback.current = false;
    src.get(i).then((u) => alive && setUrl(u)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [src, i]);

  const onError = async () => {
    if (triedFallback.current) return setFailed(true);
    triedFallback.current = true;
    const fb = await src.fallback(i);
    if (fb) setUrl(fb);
    else setFailed(true);
  };

  const style: React.CSSProperties =
    mode === "vertical"
      ? { width: fit === "width" ? "100%" : "auto", maxWidth: "100%", maxHeight: fit === "height" ? "100vh" : undefined, display: "block", margin: "0 auto" }
      : fit === "width"
        ? { width: "100%", height: "auto", display: "block", margin: "0 auto" }
        : { maxHeight: "100vh", maxWidth: "100%", display: "block", margin: "0 auto" };

  if (failed) return <Box sx={{ height: 300, display: "grid", placeItems: "center", color: "#999" }}>Sayfa {i + 1} yüklenemedi</Box>;
  if (!url) return <Box sx={{ height: mode === "vertical" ? 600 : "100vh", display: "grid", placeItems: "center" }}><CircularProgress size={28} /></Box>;
  return <img src={url} alt={`Sayfa ${i + 1}`} style={style} onError={onError} onLoad={onLoad} draggable={false} />;
}

function Reader() {
  const params = useSearchParams();
  const router = useRouter();
  const mangaId = Number(params.get("id"));
  const chId = Number(params.get("ch"));

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [manga, setManga] = useState<Manga | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [src, setSrc] = useState<PageSource | null>(null);
  const [page, setPage] = useState(0);
  const [ui, setUi] = useState(true);
  const [error, setError] = useState("");
  const [libError, setLibError] = useState<LibraryError | null>(null);
  const [retry, setRetry] = useState(0);
  const [finished, setFinished] = useState(false);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    ensureSynced().then(() => setSettings({ ...DEFAULTS, ...readStore<Partial<Settings>>("kirokuReader", {}), ...stateGetJson<Partial<Settings>>(SETTINGS_KEY, {}) }));
  }, []);
  const update = (s: Partial<Settings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...s };
      stateSetJson(SETTINGS_KEY, next);
      return next;
    });

  useEffect(() => {
    if (!mangaId) return;
    MangaService.get(mangaId).then(setManga).catch((e) => setError(errorText(e)));
    ChapterService.list(mangaId).then(setChapters).catch((e) => setError(errorText(e)));
  }, [mangaId]);

  const chapter = chapters.find((c) => c.id === chId) ?? null;

  // Prev/next within the same language, ordered by number
  const { prev, next } = useMemo(() => {
    if (!chapter) return { prev: null, next: null };
    const list = chapters.filter((c) => c.lang === chapter.lang).sort((a, b) => a.number - b.number || a.id - b.id);
    const idx = list.findIndex((c) => c.id === chapter.id);
    return { prev: list[idx - 1] ?? null, next: list[idx + 1] ?? null };
  }, [chapters, chapter]);

  useEffect(() => {
    if (!chapter) return;
    let alive = true;
    let created: PageSource | null = null;
    setSrc(null);
    setFinished(false);
    restored.current = false;
    pageRefs.current = [];
    setLibError(null);
    Promise.all([pageSource(chapter), ensureSynced()])
      .then(([s]) => {
        created = s;
        if (!alive) return s.dispose();
        setSrc(s);
        const saved = stateGetJson<{ page: number } | null>(posKey(chapter.id), null)?.page ?? readStore<{ page: number }>(`kirokuReaderPos:${chapter.id}`, { page: 0 }).page;
        setPage(Math.min(Math.max(0, saved), s.count - 1));
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof LibraryError) setLibError(e);
        else setError(`Bölüm açılamadı: ${errorText(e)}`);
      });
    return () => {
      alive = false;
      created?.dispose();
    };
  }, [chapter, retry]);

  // Library not reachable / not picked: let the user pick the folder or this one CBZ file
  const openPickedFile = async (file: File | undefined) => {
    if (!file || !chapter) return;
    try {
      const s = await cbzSource(await file.arrayBuffer());
      setLibError(null);
      setSrc((old) => {
        old?.dispose();
        return s;
      });
      setPage(0);
    } catch (e) {
      setError(`CBZ açılamadı: ${errorText(e)}`);
    }
  };

  // Remember position; reaching the last page marks the chapter as read (once)
  useEffect(() => {
    if (!src || !chapter) return;
    const partial = page > 0 && page < src.count - 1;
    stateSetJson(posKey(chapter.id), partial ? { page } : null);
    // "Continue reading" entry for the home page: one per manga, dropped once the chapter is finished
    if (manga) stateSetJson(contKey(mangaId), partial ? { mangaId, title: manga.name, cover: manga.cover, chapterId: chapter.id, number: chapter.number, page, count: src.count, t: Date.now() } : null);
    preload(src, page + 1, settings.mode === "paged" ? 3 : 4);
    if (page >= src.count - 1 && !finished) {
      setFinished(true);
      if (chapter.number >= 1 && (manga?.chaptersRead ?? 0) < Math.floor(chapter.number)) {
        MangaService.saveProgress(mangaId, Math.floor(chapter.number)).then(setManga).catch(() => {});
      }
    }
  }, [page, src, chapter, finished, manga, mangaId, settings.mode]);

  // Vertical mode: restore the scroll position once, then follow the page in view
  useEffect(() => {
    if (!src || settings.mode !== "vertical") return;
    if (!restored.current) {
      restored.current = true;
      if (page > 0) setTimeout(() => pageRefs.current[page]?.scrollIntoView({ block: "start" }), 50);
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setPage(Number((e.target as HTMLElement).dataset.page));
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    pageRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [src, settings.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const goChapter = useCallback((c: Chapter | null) => c && router.push(`/manga/read?id=${mangaId}&ch=${c.id}`), [router, mangaId]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!src) return;
      if (settings.mode === "vertical") {
        rootRef.current?.scrollBy({ top: dir * window.innerHeight * 0.85, behavior: "smooth" });
        return;
      }
      const target = page + dir;
      if (target >= src.count) return goChapter(next);
      if (target < 0) return goChapter(prev);
      setPage(target);
      rootRef.current?.scrollTo({ top: 0 });
    },
    [src, settings.mode, page, next, prev, goChapter]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [role=combobox]")) return;
      const fwd = settings.rtl ? "ArrowLeft" : "ArrowRight";
      const back = settings.rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd || e.key === "PageDown" || (e.key === " " && !e.shiftKey) || (settings.mode === "paged" && e.key === "ArrowDown")) {
        e.preventDefault();
        step(1);
      } else if (e.key === back || e.key === "PageUp" || (e.key === " " && e.shiftKey) || (settings.mode === "paged" && e.key === "ArrowUp")) {
        e.preventDefault();
        step(-1);
      } else if (e.key === "]" || e.key === "n") goChapter(next);
      else if (e.key === "[" || e.key === "p") goChapter(prev);
      else if (e.key === "Escape") router.push(`/manga/detail?id=${mangaId}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings, step, goChapter, next, prev, router, mangaId]);

  // Tap zones: outer thirds turn pages (mirrored for RTL), middle toggles the toolbar
  const onTap = (e: React.MouseEvent) => {
    const x = e.clientX / window.innerWidth;
    if (settings.mode === "vertical" || (x > 0.33 && x < 0.67)) return setUi((u) => !u);
    const right = x >= 0.67;
    step(right !== settings.rtl ? 1 : -1);
  };

  if (!mangaId || !chId) return <Alert severity="error">Geçersiz bağlantı</Alert>;
  if (error) return <Alert severity="error" action={<Button component={Link} href={`/manga/detail?id=${mangaId}`} color="inherit">Geri</Button>}>{error}</Alert>;

  const bar = { position: "fixed" as const, left: 0, right: 0, zIndex: 1301, px: { xs: 1, md: 2 }, py: 0.75, display: "flex", alignItems: "center", gap: 1, background: "rgba(10,10,12,0.88)", backdropFilter: "blur(8px)", color: "#eee", transition: "transform .2s" };

  return (
    <Box sx={{ position: "fixed", inset: 0, zIndex: 1300, backgroundColor: "#0a0a0c", overflowY: "auto" }} ref={rootRef}>
      <Box sx={{ ...bar, top: 0, transform: ui ? "none" : "translateY(-100%)" }}>
        <Tooltip title="Kapat (Esc)"><IconButton component={Link} href={`/manga/detail?id=${mangaId}`} sx={{ color: "inherit" }}><CloseRoundedIcon /></IconButton></Tooltip>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: 600 }}>{manga?.name}</Typography>
          {chapter && (
            <Select variant="standard" size="small" value={chapter.id} onChange={(e) => goChapter(chapters.find((c) => c.id === Number(e.target.value)) ?? null)}
              sx={{ color: "inherit", fontSize: "0.75rem", maxWidth: "100%", "& .MuiSelect-icon": { color: "inherit" } }} MenuProps={{ sx: { zIndex: 1400 } }}>
              {chapters.filter((c) => c.lang === chapter.lang).map((c) => <MenuItem key={c.id} value={c.id}>{chapterLabel(c)}</MenuItem>)}
            </Select>
          )}
        </Box>
        <ToggleButtonGroup size="small" exclusive value={settings.mode} onChange={(_, v) => v && update({ mode: v })} sx={{ "& .MuiToggleButton-root": { color: "#bbb" } }}>
          <ToggleButton value="vertical"><Tooltip title="Dikey (webtoon)"><ViewDayRoundedIcon fontSize="small" /></Tooltip></ToggleButton>
          <ToggleButton value="paged"><Tooltip title="Sayfa sayfa"><AutoStoriesRoundedIcon fontSize="small" /></Tooltip></ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title={settings.rtl ? "Sağdan sola" : "Soldan sağa"}>
          <IconButton onClick={() => update({ rtl: !settings.rtl })} sx={{ color: settings.rtl ? "primary.main" : "inherit" }}><SwapHorizRoundedIcon /></IconButton>
        </Tooltip>
        <Tooltip title={settings.fit === "width" ? "Genişliğe sığdır" : "Yüksekliğe sığdır"}>
          <IconButton onClick={() => update({ fit: settings.fit === "width" ? "height" : "width" })} sx={{ color: "inherit", transform: settings.fit === "height" ? "rotate(90deg)" : "none" }}><FitScreenRoundedIcon /></IconButton>
        </Tooltip>
      </Box>

      <Box onClick={onTap} sx={{ minHeight: "100vh", maxWidth: settings.mode === "vertical" && settings.fit === "width" ? 900 : "none", mx: "auto" }}>
        {libError ? (
          <Box onClick={(e) => e.stopPropagation()} sx={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5, color: "#ddd", px: 2, textAlign: "center" }}>
            <Typography>{libError.message}</Typography>
            {chapter?.filePath && <Typography sx={{ fontSize: "0.75rem", color: "#888" }}>{chapter.filePath}</Typography>}
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
              {canPickFolder() && <Button variant="outlined" onClick={() => pickLocalFolder().then(() => setRetry((r) => r + 1)).catch(() => {})}>Kütüphane klasörünü seç</Button>}
              <Button variant="contained" component="label">
                CBZ dosyasını seç
                <input hidden type="file" accept=".cbz,.zip" onChange={(e) => openPickedFile(e.target.files?.[0])} />
              </Button>
              <Button component={Link} href={`/manga/detail?id=${mangaId}`}>Kütüphane ayarları</Button>
            </Box>
          </Box>
        ) : !src ? (
          <Box sx={{ height: "100vh", display: "grid", placeItems: "center" }}><CircularProgress /></Box>
        ) : settings.mode === "vertical" ? (
          <>
            {Array.from({ length: src.count }, (_, i) => (
              <div key={i} data-page={i} ref={(el) => { pageRefs.current[i] = el; }}>
                {Math.abs(i - page) <= 6 || i < 2 ? <PageImg src={src} i={i} fit={settings.fit} mode="vertical" /> : <Box sx={{ height: 900 }} />}
              </div>
            ))}
            <ChapterEnd prev={prev} next={next} onGo={goChapter} mangaId={mangaId} />
          </>
        ) : (
          <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none" }}>
            <PageImg src={src} i={page} fit={settings.fit} mode="paged" />
          </Box>
        )}
      </Box>

      {src && (
        <Box sx={{ ...bar, bottom: 0, transform: ui ? "none" : "translateY(100%)", flexDirection: settings.rtl ? "row-reverse" : "row" }}>
          <Tooltip title="Önceki bölüm ([)"><span><IconButton disabled={!prev} onClick={() => goChapter(prev)} sx={{ color: "inherit" }}>{settings.rtl ? <NavigateNextRoundedIcon /> : <NavigateBeforeRoundedIcon />}</IconButton></span></Tooltip>
          <Slider size="small" min={0} max={Math.max(0, src.count - 1)} value={page}
            onChange={(_, v) => {
              const p = v as number;
              setPage(p);
              if (settings.mode === "vertical") pageRefs.current[p]?.scrollIntoView({ block: "start" });
            }}
            sx={{ flex: 1, mx: 1, transform: settings.rtl ? "scaleX(-1)" : "none" }} />
          <Typography sx={{ fontSize: "0.75rem", minWidth: 56, textAlign: "center" }}>{page + 1} / {src.count}</Typography>
          <Tooltip title="Sonraki bölüm (])"><span><IconButton disabled={!next} onClick={() => goChapter(next)} sx={{ color: "inherit" }}>{settings.rtl ? <NavigateBeforeRoundedIcon /> : <NavigateNextRoundedIcon />}</IconButton></span></Tooltip>
        </Box>
      )}
    </Box>
  );
}

function ChapterEnd({ prev, next, onGo, mangaId }: { prev: Chapter | null; next: Chapter | null; onGo: (c: Chapter | null) => void; mangaId: number }) {
  return (
    <Box onClick={(e) => e.stopPropagation()} sx={{ py: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, color: "#ddd" }}>
      <Typography sx={{ fontWeight: 600 }}>Bölüm sonu</Typography>
      <Box sx={{ display: "flex", gap: 1 }}>
        {prev && <Button variant="outlined" onClick={() => onGo(prev)}>Önceki: {prev.number}</Button>}
        {next ? <Button variant="contained" onClick={() => onGo(next)}>Sonraki: {next.number}</Button> : <Button component={Link} href={`/manga/detail?id=${mangaId}`} variant="contained">Mangaya dön</Button>}
      </Box>
    </Box>
  );
}

export default function MangaReaderPage() {
  return (
    <Suspense fallback={<Box sx={{ height: "100vh", display: "grid", placeItems: "center" }}><CircularProgress /></Box>}>
      <Reader />
    </Suspense>
  );
}
