"use client";

// Salon oynatıcı: project-v prototipinin React'e taşınmış hâli. Oynat/duraklat, ses, zaman çizgisinde sürükleme,
// hız, altyazı, mini oynatıcı (resim içinde resim), sinema modu, tam ekran ve klavye kısayolları
// (boşluk/k, f, t, i, m, c, ←/→ ya da j/l, ↑/↓, 0–9, n/p: sonraki/önceki bölüm).
// Dosyanın içindeki ses ve altyazı izleri (sunucu ffmpeg ile listeliyorsa) ayar menüsünden seçilir. Tarayıcı çok sesli
// dosyalarda yalnızca ilk sesi çaldığı için başka bir ses seçilince video aynen, ses AAC'ye çevrilmiş bir akış açılır;
// bu akışta sarma yeni bir akış başlatır (en yakın anahtar kareden). Ok tuşuyla art arda sarma tek bir sarmaya birleştirilir.

import { useCallback, useEffect, useRef, useState } from "react";
import { shiftVtt, type MediaTrack, type MediaTracks } from "../../lib/videoLibrary";
import "./salon.css";

type Props = {
  src: string;
  subtitle?: string | null;
  tracks?: MediaTracks | null;
  audioUrl?: (audioIndex: number, start: number, compat: boolean) => string;
  snapStart?: (t: number) => Promise<number>;
  loadSubtitle?: (subIndex: number) => Promise<string>;
  /** Verilirse ayar menüsünde "Altyazı bul…" çıkar */
  onFindSubtitles?: () => void;
  title?: string;
  startAt?: number;
  theater: boolean;
  onTheaterChange: (v: boolean) => void;
  onProgress?: (time: number, duration: number) => void;
  onEnded?: () => void;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SEEK_GATE_MS = 250;
const LANG2: Record<string, string> = { jpn: "ja", eng: "en", tur: "tr", ger: "de", deu: "de", fre: "fr", fra: "fr", spa: "es", por: "pt", ita: "it", rus: "ru", kor: "ko", chi: "zh", zho: "zh", ara: "ar", ind: "id", pol: "pl", dut: "nl", nld: "nl", tha: "th", vie: "vi", hin: "hi" };
const pad = (n: number) => String(n).padStart(2, "0");

export function formatDuration(time: number) {
  if (!Number.isFinite(time)) return "0:00";
  const s = Math.floor(time % 60);
  const m = Math.floor(time / 60) % 60;
  const h = Math.floor(time / 3600);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function langName(code: string) {
  const two = LANG2[code];
  if (two) {
    try {
      const name = new Intl.DisplayNames(["tr"], { type: "language" }).of(two);
      if (name) return name;
    } catch {}
  }
  return !code || code === "und" ? "Bilinmiyor" : code.toUpperCase();
}
function trackLabel(t: MediaTrack) {
  const lang = langName(t.lang);
  const extra = t.title && t.title.toLowerCase() !== lang.toLowerCase() ? ` · ${t.title}` : "";
  return `${lang}${extra}${t.forced ? " (zorunlu)" : ""}`;
}

type SubSel = { kind: "off" } | { kind: "external" } | { kind: "embedded"; index: number };
type Prefs = { volume?: number; captions?: boolean; audioLang?: string; subLang?: string; compat?: boolean };

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem("kirokuSalon") ?? "{}") as Prefs;
  } catch {
    return {};
  }
}
/** The audio track the browser plays by itself (default flag, else the first) */
const nativeAudio = (tracks?: MediaTracks | null) => tracks?.audio.find((a) => a.default) ?? tracks?.audio[0];

function initialAudio(tracks: MediaTracks | null | undefined, prefs: Prefs): number | null {
  const native = nativeAudio(tracks);
  if (!tracks || !native) return null;
  const wanted = prefs.audioLang ? tracks.audio.find((a) => a.lang === prefs.audioLang) : undefined;
  // Compatibility mode always streams (transcoded), even for the browser's own audio track
  if (prefs.compat) return (wanted ?? native).index;
  return wanted && wanted.index !== native.index ? wanted.index : null;
}
function initialSub(tracks: MediaTracks | null | undefined, hasExternal: boolean, prefs: Prefs): SubSel {
  if (prefs.subLang === "off") return { kind: "off" };
  const lang = prefs.subLang ?? "tur";
  const texts = (tracks?.subtitles ?? []).filter((t) => t.text);
  const full = (t: MediaTrack) => !t.forced && !/sign|song|şarkı/i.test(t.title);
  const wanted = texts.find((t) => t.lang === lang && full(t)) ?? texts.find((t) => t.lang === lang);
  if (wanted) return { kind: "embedded", index: wanted.index };
  if (hasExternal) return { kind: "external" };
  const fallback = texts.find((t) => t.default && full(t));
  return fallback ? { kind: "embedded", index: fallback.index } : { kind: "off" };
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path fill="currentColor" d={d} />
  </svg>
);
const ICONS = {
  play: "M8,5.14V19.14L19,12.14L8,5.14Z",
  pause: "M14,19H18V5H14M6,19H10V5H6V19Z",
  high: "M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z",
  low: "M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z",
  muted:
    "M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z",
  captions:
    "M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z",
  mini: "M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-10-7h9v6h-9z",
  tall: "M19 6H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H5V8h14v8z",
  wide: "M19 7H5c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 8H5V9h14v6z",
  open: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  close: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
  prev: "M6 6h2v12H6zm3.5 6l8.5 6V6z",
  next: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  settings:
    "M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.488.488 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z",
};

export default function SalonPlayer({
  src,
  subtitle,
  tracks,
  audioUrl,
  snapStart,
  loadSubtitle,
  onFindSubtitles,
  title,
  startAt = 0,
  theater,
  onTheaterChange,
  onProgress,
  onEnded,
  onPrev,
  onNext,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(tracks?.duration ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [preview, setPreview] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [idle, setIdle] = useState(false);
  const [skip, setSkip] = useState<{ total: number; key: number } | null>(null);
  const [flash, setFlash] = useState<{ key: number; icon: "play" | "pause" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");

  // Ses izi: null = tarayıcının kendiliğinden çaldığı iz; sayı = o izle açılan akış (base: akışın başladığı saniye)
  const [audio, setAudio] = useState<number | null>(() => initialAudio(tracks, readPrefs()));
  const [base, setBase] = useState<number | null>(() => (initialAudio(tracks, readPrefs()) === null ? 0 : null));
  const [subSel, setSubSel] = useState<SubSel>(() => initialSub(tracks, Boolean(subtitle), readPrefs()));
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [compat, setCompat] = useState<boolean>(() => Boolean(readPrefs().compat));
  const audioRef = useRef(audio);
  const baseRef = useRef(base);
  audioRef.current = audio;
  baseRef.current = base;
  const streaming = audio !== null;
  const total = streaming ? tracks?.duration || duration : duration;

  const wasPaused = useRef(true);
  const keepPaused = useRef(false);
  const holdPause = useRef(false);
  const resumeAt = useRef(startAt);
  const switchToken = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const seekGate = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cursor = useRef<number | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const video = () => videoRef.current;
  /** Videonun içeriğindeki gerçek konum (akışta akışın başlangıcı eklenir) */
  const clock = useCallback(() => (audioRef.current !== null ? (baseRef.current ?? 0) : 0) + (videoRef.current?.currentTime ?? 0), []);
  const totalRef = useRef(total);
  totalRef.current = total;

  const savePrefs = (patch: Partial<Prefs>) => {
    try {
      localStorage.setItem("kirokuSalon", JSON.stringify({ ...readPrefs(), ...patch }));
    } catch {}
  };

  // Ses ve altyazı tercihleri tarayıcıda hatırlanır
  useEffect(() => {
    const saved = readPrefs();
    if (typeof saved.volume === "number") setVolume(saved.volume);
    if (typeof saved.captions === "boolean") setCaptions(saved.captions);
  }, []);
  useEffect(() => {
    savePrefs({ volume, captions });
    const v = video();
    if (v) v.volume = volume;
  }, [volume, captions]);

  useEffect(() => {
    const v = video();
    if (v) v.muted = muted;
  }, [muted]);

  // Kaynak değişince sıfırla
  useEffect(() => {
    setError("");
    setTime(0);
    setBuffered(0);
    setReady(false);
    if (!tracks) setDuration(0);
  }, [src, tracks]);

  // Açılışta seçili ses izi kaynak videodan farklıysa akışı, kalınan yerin anahtar karesinden başlat
  useEffect(() => {
    if (audioRef.current === null || baseRef.current !== null) return;
    let alive = true;
    (snapStart ? snapStart(startAt) : Promise.resolve(startAt)).then((b) => {
      if (!alive) return;
      setBase(b);
      setTime(b);
    });
    return () => {
      alive = false;
    };
    // yalnızca ilk açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seçili altyazı izinin adresi (dışarıdaki dosya, ya da dosyanın içinden çıkarılmış). Akış videonun ortasından başladığında
  // oynatıcı saati 0'dan saydığı için altyazı zamanları akışın başlangıcı kadar öne çekilir.
  const subTexts = useRef(new Map<string, string>());
  const loadSubtitleRef = useRef(loadSubtitle);
  loadSubtitleRef.current = loadSubtitle;
  const shift = audio !== null ? (base ?? 0) : 0;
  useEffect(() => {
    if (subSel.kind === "off") return setSubUrl(null);
    let alive = true;
    let url: string | null = null;
    const cacheKey = subSel.kind === "external" ? `x:${subtitle}` : `e:${subSel.index}`;
    (async () => {
      let text = subTexts.current.get(cacheKey);
      if (text === undefined) {
        if (subSel.kind === "external") text = subtitle ? await (await fetch(subtitle)).text() : "";
        else text = loadSubtitleRef.current ? await loadSubtitleRef.current(subSel.index) : "";
        subTexts.current.set(cacheKey, text);
      }
      if (!alive) return;
      if (!text) return setSubUrl(null);
      url = URL.createObjectURL(new Blob([shiftVtt(text, shift)], { type: "text/vtt" }));
      setSubUrl(url);
    })().catch(() => alive && setSubUrl(null));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [subSel, subtitle, shift]);

  useEffect(() => {
    const v = video();
    const track = v?.textTracks[0];
    if (track) track.mode = captions && subUrl ? "showing" : "hidden";
  }, [captions, subUrl]);

  const togglePlay = useCallback(() => {
    const v = video();
    if (!v) return;
    setMenu(false);
    setFlash({ key: Date.now(), icon: v.paused ? "play" : "pause" });
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleFullScreen = useCallback(() => {
    if (document.fullscreenElement == null) rootRef.current?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  const togglePip = useCallback(() => {
    const v = video();
    if (!v) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else v.requestPictureInPicture?.().catch(() => {});
  }, []);

  /** Videonun içeriğinde t. saniyeye git (akışta: o saniyenin anahtar karesinden yeni akış) */
  const seekTo = useCallback(
    (t: number, stayPaused?: boolean) => {
      const v = video();
      if (!v) return;
      const target = Math.min(Math.max(0, t), totalRef.current > 1 ? totalRef.current - 0.1 : Infinity);
      if (audioRef.current === null) {
        v.currentTime = target;
        return;
      }
      keepPaused.current = stayPaused ?? v.paused;
      const token = ++switchToken.current;
      setBusy(true);
      (snapStart ? snapStart(target) : Promise.resolve(target)).then((b) => {
        if (token !== switchToken.current) return;
        setBase(b);
        setTime(b);
      });
    },
    [snapStart]
  );

  /** Art arda gelen sarmalar (ok tuşu basılı tutulunca) birleştirilir: ilki hemen, sonrakiler en fazla SEEK_GATE_MS'de bir uygulanır */
  const requestSeek = useCallback(
    (t: number, stayPaused?: boolean) => {
      const target = Math.min(Math.max(0, t), totalRef.current || Infinity);
      cursor.current = target;
      clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => (cursor.current = null), 800);
      setTime(target);
      if (seekGate.current) {
        pendingSeek.current = target;
        return;
      }
      seekTo(target, stayPaused);
      seekGate.current = setTimeout(() => {
        seekGate.current = undefined;
        const queued = pendingSeek.current;
        pendingSeek.current = null;
        if (queued !== null) requestSeek(queued, stayPaused);
      }, SEEK_GATE_MS);
    },
    [seekTo]
  );

  const skipBy = useCallback(
    (seconds: number) => {
      if (!videoRef.current) return;
      requestSeek((pendingSeek.current ?? cursor.current ?? clock()) + seconds);
      setSkip((prev) => ({ total: (prev && Math.sign(prev.total) === Math.sign(seconds) ? prev.total : 0) + seconds, key: Date.now() }));
      clearTimeout(skipTimer.current);
      skipTimer.current = setTimeout(() => setSkip(null), 650);
    },
    [requestSeek, clock]
  );

  const changeSpeed = useCallback((dir = 1) => {
    const v = video();
    if (!v) return;
    const i = SPEEDS.indexOf(v.playbackRate);
    const next = SPEEDS[(Math.max(0, i) + dir + SPEEDS.length) % SPEEDS.length];
    v.playbackRate = next;
    setSpeed(next);
  }, []);

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2500);
  }, []);

  const chooseAudio = (index: number) => {
    const native = nativeAudio(tracks);
    const t = clock();
    const track = tracks?.audio.find((a) => a.index === index);
    if (track) savePrefs({ audioLang: track.lang });
    setMenu(false);
    const v = video();
    keepPaused.current = v?.paused ?? false;
    const token = ++switchToken.current;
    if (!native || (index === native.index && !compat)) {
      if (audioRef.current === null) return;
      resumeAt.current = t;
      setAudio(null);
      setBase(0);
      setBusy(true);
      return;
    }
    if (audioRef.current === index) return;
    setBusy(true);
    setAudio(index);
    (snapStart ? snapStart(t) : Promise.resolve(t)).then((b) => {
      if (token !== switchToken.current) return;
      setBase(b);
      setTime(b);
    });
  };

  // Compatibility mode: the server transcodes the video to 8-bit H.264 (for codecs the browser cannot decode, e.g. HEVC 10-bit in Firefox)
  const toggleCompat = () => {
    const next = !compat;
    const native = nativeAudio(tracks);
    savePrefs({ compat: next });
    setCompat(next);
    setMenu(false);
    if (!native) return;
    const t = clock();
    keepPaused.current = video()?.paused ?? false;
    const token = ++switchToken.current;
    setBusy(true);
    if (next) {
      setAudio(audioRef.current ?? native.index);
      (snapStart ? snapStart(t) : Promise.resolve(t)).then((b) => {
        if (token !== switchToken.current) return;
        setBase(b);
        setTime(b);
      });
    } else if (audioRef.current === native.index) {
      resumeAt.current = t;
      setAudio(null);
      setBase(0);
    }
  };

  const chooseSub = (sel: SubSel) => {
    setSubSel(sel);
    setCaptions(sel.kind !== "off");
    if (sel.kind === "off") savePrefs({ subLang: "off" });
    else if (sel.kind === "embedded") {
      const track = tracks?.subtitles.find((s) => s.index === sel.index);
      if (track) savePrefs({ subLang: track.lang });
    }
    setMenu(false);
  };

  // Klavye kısayolları (yazı alanlarında devre dışı)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = video();
      if (!v) return;
      const key = e.key.toLowerCase();
      let handled = true;
      switch (key) {
        case " ":
          if (tag === "button") return;
        // falls through
        case "k":
          togglePlay();
          break;
        case "f":
          toggleFullScreen();
          break;
        case "t":
          onTheaterChange(!theater);
          break;
        case "i":
          togglePip();
          break;
        case "m":
          setMuted((m) => !m);
          break;
        case "c":
          setCaptions((c) => !c);
          break;
        case "escape":
          if (!menu) return;
          setMenu(false);
          break;
        case "arrowleft":
        case "j":
          skipBy(key === "j" ? -10 : -5);
          break;
        case "arrowright":
        case "l":
          skipBy(key === "l" ? 10 : 5);
          break;
        case "arrowup":
          setVolume((vol) => Math.min(1, Math.round((vol + 0.05) * 100) / 100));
          setMuted(false);
          break;
        case "arrowdown":
          setVolume((vol) => Math.max(0, Math.round((vol - 0.05) * 100) / 100));
          break;
        case "<":
          changeSpeed(-1);
          break;
        case ">":
          changeSpeed(1);
          break;
        case "n":
          if (e.shiftKey || !onNext) return;
          onNext();
          break;
        case "p":
          if (e.shiftKey || !onPrev) return;
          onPrev();
          break;
        default:
          if (/^[0-9]$/.test(key) && totalRef.current) requestSeek((totalRef.current / 10) * Number(key));
          else handled = false;
      }
      if (handled) {
        e.preventDefault();
        wake();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleFullScreen, togglePip, skipBy, requestSeek, changeSpeed, onTheaterChange, theater, onNext, onPrev, wake, menu]);

  useEffect(() => {
    const v = video();
    if (!v) return;
    const enter = () => setPip(true);
    const leave = () => setPip(false);
    v.addEventListener("enterpictureinpicture", enter);
    v.addEventListener("leavepictureinpicture", leave);
    return () => {
      v.removeEventListener("enterpictureinpicture", enter);
      v.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  useEffect(() => {
    const onFs = () => setFullScreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      clearTimeout(idleTimer.current);
      clearTimeout(skipTimer.current);
      clearTimeout(seekGate.current);
      clearTimeout(cursorTimer.current);
    };
  }, []);

  // Zaman çizgisi: fareyle üzerine gelince önizleme zamanı, basılı tutup sürükleyince sarma
  const percentAt = (x: number) => {
    const rect = timelineRef.current!.getBoundingClientRect();
    return Math.min(Math.max(0, x - rect.x), rect.width) / rect.width;
  };
  useEffect(() => {
    if (!scrubbing) return;
    const move = (e: MouseEvent) => {
      const p = percentAt(e.clientX);
      setPreview(p);
      if (totalRef.current) setTime(p * totalRef.current);
    };
    const up = (e: MouseEvent) => {
      setScrubbing(false);
      if (!totalRef.current) return;
      const t = percentAt(e.clientX) * totalRef.current;
      const v = video();
      if (audioRef.current === null) {
        if (v) v.currentTime = t;
        if (!wasPaused.current) v?.play().catch(() => {});
      } else seekTo(t, wasPaused.current);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [scrubbing, seekTo]);

  const volumeLevel = muted || volume === 0 ? "muted" : volume >= 0.5 ? "high" : "low";
  const progress = total ? Math.min(1, time / total) : 0;
  const hasMenu = Boolean(tracks && (tracks.audio.length > 1 || tracks.subtitles.some((s) => s.text))) || Boolean(subtitle) || Boolean(onFindSubtitles);
  const subActive = captions && Boolean(subUrl);
  const cls = ["kk-salon", paused && "paused", theater && "theater", fullScreen && "full-screen", pip && "mini-player", subActive && "captions", scrubbing && "scrubbing", idle && "idle", ready && "ready", busy && "busy"]
    .filter(Boolean)
    .join(" ");
  const videoSrc = audio === null ? src : base === null ? undefined : (audioUrl?.(audio, base, compat) ?? src);
  const nativeTrack = nativeAudio(tracks);
  const activeAudio = audio ?? nativeTrack?.index;

  return (
    <div ref={rootRef} className={cls} tabIndex={-1} onMouseMove={wake} onMouseLeave={() => setIdle(true)}>
      <video
        ref={videoRef}
        src={videoSrc}
        autoPlay
        preload="auto"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullScreen}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onLoadStart={() => setBusy(true)}
        onWaiting={() => setBusy(true)}
        onSeeking={() => setBusy(true)}
        onSeeked={() => setBusy(false)}
        onCanPlay={() => setBusy(false)}
        onPlaying={() => setBusy(false)}
        onLoadedData={(e) => {
          setReady(true);
          // Kalınan yere ilk kare çözüldükten sonra git: metadata aşamasında sarmak bazı tarayıcılarda (özellikle HEVC/MKV) siyah ekran bırakıyor
          const v = e.currentTarget;
          const at = resumeAt.current;
          const hold = holdPause.current;
          resumeAt.current = 0;
          holdPause.current = false;
          if (audioRef.current === null && at > 5 && at < v.duration - 10) {
            v.currentTime = at;
            if (!hold && v.paused) v.play().catch(() => {});
          }
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(audioRef.current !== null ? tracks?.duration || 0 : v.duration);
          v.volume = volume;
          v.playbackRate = speed;
          if (keepPaused.current) {
            keepPaused.current = false;
            holdPause.current = true;
            v.pause();
          }
          const track = v.textTracks[0];
          if (track) track.mode = captions && subUrl ? "showing" : "hidden";
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          const now = (audioRef.current !== null ? (baseRef.current ?? 0) : 0) + v.currentTime;
          if (!scrubbing && pendingSeek.current === null) setTime(now);
          // Sarma bitince 'seeked'/'playing' hiç gelmeyen tarayıcılarda yükleme simgesi takılı kalmasın
          if (v.readyState >= 3 && !v.seeking) setBusy(false);
          onProgress?.(now, totalRef.current);
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (audioRef.current === null && v.duration && v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
        }}
        onVolumeChange={(e) => {
          setMuted(e.currentTarget.muted);
        }}
        onEnded={onEnded}
        onError={() => setError("Video açılamadı. Dosya biçimi tarayıcıda desteklenmiyor olabilir (MP4/H.264 ya da WebM önerilir) veya sunucuya ulaşılamıyor.")}
      >
        {subUrl ? <track key={subUrl} kind="captions" srcLang="tr" label="Altyazı" src={subUrl} default /> : null}
      </video>

      {busy && !error ? <div className="spinner" aria-label="Yükleniyor" /> : null}
      {flash ? (
        <div key={flash.key} className="center-flash" aria-hidden>
          <Icon d={ICONS[flash.icon]} />
        </div>
      ) : null}
      {skip ? (
        <div key={skip.key} className={`skip-badge ${skip.total > 0 ? "forward" : "back"}`}>
          {skip.total > 0 ? `+${skip.total}` : skip.total} sn
        </div>
      ) : null}
      {error ? <div className="center-msg">{error}</div> : null}

      {menu ? (
        <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
          {tracks && tracks.audio.length > 1 ? (
            <div className="settings-group">
              <div className="settings-title">Ses</div>
              {tracks.audio.map((a) => (
                <button key={a.index} className={a.index === activeAudio ? "active" : ""} onClick={() => chooseAudio(a.index)}>
                  {trackLabel(a)}
                </button>
              ))}
              {audio !== null ? <div className="settings-note">Bu ses için video yeniden akıtılıyor; sarma birkaç saniye geriden başlayabilir.</div> : null}
            </div>
          ) : null}
          {tracks ? (
            <div className="settings-group">
              <div className="settings-title">Görüntü</div>
              <button className={compat ? "active" : ""} onClick={toggleCompat}>
                Uyumlu mod (H.264'e çevir)
              </button>
              <div className="settings-note">Siyah ekran ama ses varsa aç. Sunucu videoyu 720p'ye çevirir.</div>
            </div>
          ) : null}
          <div className="settings-group">
            <div className="settings-title">Altyazı</div>
            <button className={!subActive ? "active" : ""} onClick={() => chooseSub({ kind: "off" })}>
              Kapalı
            </button>
            {subtitle ? (
              <button className={subActive && subSel.kind === "external" ? "active" : ""} onClick={() => chooseSub({ kind: "external" })}>
                Dosyanın yanındaki altyazı
              </button>
            ) : null}
            {(tracks?.subtitles ?? []).map((s) =>
              s.text ? (
                <button key={s.index} className={subActive && subSel.kind === "embedded" && subSel.index === s.index ? "active" : ""} onClick={() => chooseSub({ kind: "embedded", index: s.index })}>
                  {trackLabel(s)}
                </button>
              ) : null
            )}
            {(tracks?.subtitles ?? []).some((s) => !s.text) ? <div className="settings-note">Resim biçimindeki (PGS/VobSub) altyazılar gösterilemez.</div> : null}
            {onFindSubtitles ? (
              <button
                onClick={() => {
                  setMenu(false);
                  onFindSubtitles();
                }}
              >
                Altyazı bul…
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="controls-wrap">
        <div
          className="timeline-container"
          ref={timelineRef}
          onMouseMove={(e) => setPreview(percentAt(e.clientX))}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const v = video();
            wasPaused.current = v?.paused ?? true;
            if (audioRef.current === null) v?.pause();
            setPreview(percentAt(e.clientX));
            setScrubbing(true);
          }}
          style={{ ["--progress-position" as string]: scrubbing ? preview : progress, ["--preview-position" as string]: preview, ["--buffered-position" as string]: buffered }}
        >
          <div className="timeline">
            <div className="buffered" />
            <div className="preview-time">{formatDuration(preview * total)}</div>
            <div className="thumb-indicator" />
          </div>
        </div>
        <div className="controls">
          {onPrev !== undefined ? (
            <button onClick={() => onPrev?.()} disabled={!onPrev} title="Önceki bölüm (p)">
              <Icon d={ICONS.prev} />
            </button>
          ) : null}
          <button onClick={togglePlay} title={paused ? "Oynat (k)" : "Duraklat (k)"}>
            <Icon d={paused ? ICONS.play : ICONS.pause} />
          </button>
          {onNext !== undefined ? (
            <button onClick={() => onNext?.()} disabled={!onNext} title="Sonraki bölüm (n)">
              <Icon d={ICONS.next} />
            </button>
          ) : null}
          <div className="volume-container">
            <button onClick={() => setMuted((m) => !m)} title="Sesi kapat (m)">
              <Icon d={ICONS[volumeLevel]} />
            </button>
            <input
              className="volume-slider"
              type="range"
              min={0}
              max={1}
              step="any"
              value={muted ? 0 : volume}
              onChange={(e) => {
                const value = Number(e.target.value);
                setVolume(value);
                setMuted(value === 0);
              }}
              aria-label="Ses"
            />
          </div>
          <div className="duration">
            <span>{formatDuration(time)}</span>/<span>{formatDuration(total)}</span>
            {title ? <span className="title">{title}</span> : null}
          </div>
          {subUrl || subtitle || tracks?.subtitles.some((s) => s.text) ? (
            <button className="captions-btn" onClick={() => setCaptions((c) => !c)} title="Altyazıyı aç/kapat (c)">
              <Icon d={ICONS.captions} />
            </button>
          ) : null}
          {hasMenu ? (
            <button className={menu ? "menu-open" : ""} onClick={() => setMenu((m) => !m)} title="Ses ve altyazı seç">
              <Icon d={ICONS.settings} />
            </button>
          ) : null}
          <button className="wide-btn" onClick={() => changeSpeed(1)} onContextMenu={(e) => (e.preventDefault(), changeSpeed(-1))} title="Oynatma hızı (< / >)">
            {speed}x
          </button>
          <button onClick={togglePip} title="Mini oynatıcı (i)">
            <Icon d={ICONS.mini} />
          </button>
          {!fullScreen ? (
            <button onClick={() => onTheaterChange(!theater)} title="Sinema modu (t)">
              <Icon d={theater ? ICONS.wide : ICONS.tall} />
            </button>
          ) : null}
          <button onClick={toggleFullScreen} title="Tam ekran (f)">
            <Icon d={fullScreen ? ICONS.close : ICONS.open} />
          </button>
        </div>
      </div>
    </div>
  );
}
