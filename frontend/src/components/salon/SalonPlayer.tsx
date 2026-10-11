"use client";

// Salon oynatıcı: project-v prototipinin React'e taşınmış hâli. Oynat/duraklat, ses, zaman çizgisinde sürükleme,
// hız, altyazı, mini oynatıcı (resim içinde resim), sinema modu, tam ekran ve klavye kısayolları
// (boşluk/k, f, t, i, m, c, ←/→ ya da j/l, ↑/↓, 0–9, n/p: sonraki/önceki bölüm).

import { useCallback, useEffect, useRef, useState } from "react";
import "./salon.css";

type Props = {
  src: string;
  subtitle?: string | null;
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
const pad = (n: number) => String(n).padStart(2, "0");

export function formatDuration(time: number) {
  if (!Number.isFinite(time)) return "0:00";
  const s = Math.floor(time % 60);
  const m = Math.floor(time / 60) % 60;
  const h = Math.floor(time / 3600);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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
};

export default function SalonPlayer({ src, subtitle, title, startAt = 0, theater, onTheaterChange, onProgress, onEnded, onPrev, onNext }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [preview, setPreview] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [idle, setIdle] = useState(false);
  const [skip, setSkip] = useState<{ total: number; key: number } | null>(null);
  const [error, setError] = useState("");
  const wasPaused = useRef(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const video = () => videoRef.current;

  // Ses ve hız tercihleri tarayıcıda hatırlanır
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("kirokuSalon") ?? "{}");
      if (typeof saved.volume === "number") setVolume(saved.volume);
      if (typeof saved.captions === "boolean") setCaptions(saved.captions);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("kirokuSalon", JSON.stringify({ volume, captions }));
    } catch {}
    const v = video();
    if (v) v.volume = volume;
  }, [volume, captions]);

  useEffect(() => {
    const v = video();
    if (v) v.muted = muted;
  }, [muted]);

  // Kaynak değişince sıfırla; kaldığı yerden devam et
  useEffect(() => {
    setError("");
    setTime(0);
    setDuration(0);
    setBuffered(0);
  }, [src]);

  useEffect(() => {
    const v = video();
    const track = v?.textTracks[0];
    if (track) track.mode = captions ? "showing" : "hidden";
  }, [captions, subtitle]);

  const togglePlay = useCallback(() => {
    const v = video();
    if (!v) return;
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

  const skipBy = useCallback((seconds: number) => {
    const v = video();
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + seconds), v.duration || Infinity);
    setSkip((prev) => ({ total: (prev && Math.sign(prev.total) === Math.sign(seconds) ? prev.total : 0) + seconds, key: Date.now() }));
    clearTimeout(skipTimer.current);
    skipTimer.current = setTimeout(() => setSkip(null), 650);
  }, []);

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
          if (/^[0-9]$/.test(key) && v.duration) v.currentTime = (v.duration / 10) * Number(key);
          else handled = false;
      }
      if (handled) {
        e.preventDefault();
        wake();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleFullScreen, togglePip, skipBy, changeSpeed, onTheaterChange, theater, onNext, onPrev, wake]);

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
      const v = video();
      if (v?.duration) setTime(p * v.duration);
    };
    const up = (e: MouseEvent) => {
      const v = video();
      setScrubbing(false);
      if (!v?.duration) return;
      v.currentTime = percentAt(e.clientX) * v.duration;
      if (!wasPaused.current) v.play().catch(() => {});
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [scrubbing]);

  const volumeLevel = muted || volume === 0 ? "muted" : volume >= 0.5 ? "high" : "low";
  const progress = duration ? time / duration : 0;
  const cls = ["kk-salon", paused && "paused", theater && "theater", fullScreen && "full-screen", pip && "mini-player", captions && subtitle && "captions", scrubbing && "scrubbing", idle && "idle"]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={rootRef} className={cls} tabIndex={-1} onMouseMove={wake} onMouseLeave={() => setIdle(true)}>
      <video
        ref={videoRef}
        src={src}
        autoPlay
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullScreen}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          v.volume = volume;
          v.playbackRate = speed;
          if (startAt > 5 && startAt < v.duration - 10) v.currentTime = startAt;
          const track = v.textTracks[0];
          if (track) track.mode = captions ? "showing" : "hidden";
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (!scrubbing) setTime(v.currentTime);
          onProgress?.(v.currentTime, v.duration);
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.duration && v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
        }}
        onVolumeChange={(e) => {
          setMuted(e.currentTarget.muted);
        }}
        onEnded={onEnded}
        onError={() => setError("Video açılamadı. Dosya biçimi tarayıcıda desteklenmiyor olabilir (MP4/H.264 ya da WebM önerilir) veya sunucuya ulaşılamıyor.")}
      >
        {subtitle ? <track kind="captions" srcLang="tr" label="Altyazı" src={subtitle} default /> : null}
      </video>

      {skip ? (
        <div key={skip.key} className={`skip-badge ${skip.total > 0 ? "forward" : "back"}`}>
          {skip.total > 0 ? `+${skip.total}` : skip.total} sn
        </div>
      ) : null}
      {error ? <div className="center-msg">{error}</div> : null}

      <div className="controls-wrap">
        <div
          className="timeline-container"
          ref={timelineRef}
          onMouseMove={(e) => setPreview(percentAt(e.clientX))}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const v = video();
            wasPaused.current = v?.paused ?? true;
            v?.pause();
            setPreview(percentAt(e.clientX));
            setScrubbing(true);
          }}
          style={{ ["--progress-position" as string]: scrubbing ? preview : progress, ["--preview-position" as string]: preview, ["--buffered-position" as string]: buffered }}
        >
          <div className="timeline">
            <div className="buffered" />
            <div className="preview-time">{formatDuration(preview * duration)}</div>
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
            <span>{formatDuration(time)}</span>/<span>{formatDuration(duration)}</span>
            {title ? <span className="title">{title}</span> : null}
          </div>
          {subtitle ? (
            <button className="captions-btn" onClick={() => setCaptions((c) => !c)} title="Altyazı (c)">
              <Icon d={ICONS.captions} />
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
