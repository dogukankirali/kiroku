"use client";

import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import { flushSync } from "react-dom";
import { Box, Typography, Chip, Skeleton, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { palette } from "../theme/customTheme";
import { useDelayedFlag } from "../lib/useDelayedFlag";
import StarIcon from "@mui/icons-material/Star";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import AnimeDetailModal, { COVER_TRANSITION_NAME, getCoverSrc, getStatusInfo } from "./anime/AnimeDetailModal";
import { coverImgStyle, coverLoadingSx, revealCover, sizedCover } from "../utils/cover";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Tarayıcı destekliyorsa durum değişikliğini View Transition içinde yapar */
function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return null;
  }
  return doc.startViewTransition(() => flushSync(update));
}

// Kartın 3B eğimi: React state yerine CSS değişkenleri, her harekette yeniden render olmasın
const badgeSx = {
  display: "flex",
  alignItems: "center",
  gap: 0.4,
  px: 0.75,
  py: 0.3,
  borderRadius: "6px",
  backgroundColor: "rgba(0,0,0,0.78)",
} as const;

function handleTilt(e: React.PointerEvent<HTMLDivElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
  el.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
  el.style.setProperty("--gx", `${x * 100}%`);
  el.style.setProperty("--gy", `${y * 100}%`);
}
function resetTilt(e: React.PointerEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  el.style.setProperty("--rx", "0deg");
  el.style.setProperty("--ry", "0deg");
}

interface AnimeGridProps {
  allData: TEATable.IAnime[]; // gridCache
  loading: boolean;
  loadingMore: boolean;
  gridSize: number;
  onLoadMore: () => void;
  // Edit / Delete / Watchlist IconButtons (same as the table's Settings column)
  renderActions?: (anime: TEATable.IAnime) => React.ReactNode;
}

// Memoized: changing columns or loading more pages doesn't re-render existing cards
const AnimeCard = memo(function AnimeCard({
  anime,
  gridSize,
  onSelect,
  renderActions,
}: {
  anime: TEATable.IAnime;
  gridSize: number;
  onSelect: (anime: TEATable.IAnime, cover: HTMLElement | null) => void;
  renderActions?: (anime: TEATable.IAnime) => React.ReactNode;
}) {
  // Kalabalık grid'de kartlar küçük; orta boy yeter (7+ sütun), aksi halde büyük kapak
  const imgSrc = sizedCover(getCoverSrc(anime.Cover), gridSize >= 7 ? "medium" : "large");
  const status = getStatusInfo(anime);
  const score = parseFloat(String(anime.Score)) || 0;
  const malScore = Number(anime.MALScore) || 0;
  const coverRef = useRef<HTMLDivElement>(null);

  return (
    <Box sx={{ width: `${100 / gridSize}%`, p: 1, flexShrink: 0, perspective: "900px" }}>
      <Box
        onClick={() => onSelect(anime, coverRef.current)}
        onPointerMove={handleTilt}
        onPointerLeave={resetTilt}
        sx={{
          "--rx": "0deg",
          "--ry": "0deg",
          "--gx": "50%",
          "--gy": "50%",
          position: "relative",
          borderRadius: "10px",
          cursor: "pointer",
          aspectRatio: "2/3",
          transform: "rotateX(var(--rx)) rotateY(var(--ry))",
          transition: "transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .25s ease",
          boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
          "&:hover": {
            transition: "transform .08s linear, box-shadow .25s ease",
            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
            "& .anime-overlay, & .anime-actions, & .anime-glare": { opacity: 1 },
          },
          "@media (prefers-reduced-motion: reduce)": { transform: "none" },
        }}
      >
        <Box
          ref={coverRef}
          sx={{ position: "absolute", inset: 0, borderRadius: "10px", overflow: "hidden", ...coverLoadingSx }}
        >
          {imgSrc ? (
            <img
              src={imgSrc}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={revealCover}
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...coverImgStyle }}
            />
          ) : (
            <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: alpha(palette.overlay, 0.3), fontSize: "0.75rem" }}>
              Kapak yok
            </Box>
          )}
        </Box>

        {/* Işık yansıması, imleci takip eder */}
        <Box
          className="anime-glare"
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: "10px",
            pointerEvents: "none",
            opacity: 0,
            transition: "opacity .25s ease",
            background: `radial-gradient(circle at var(--gx) var(--gy), ${alpha(palette.overlay, 0.18)}, transparent 55%)`,
            mixBlendMode: "overlay",
            zIndex: 1,
          }}
        />

        {(score > 0 || malScore > 0) && (
          <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 2, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
            {score > 0 && (
              <Tooltip title="Senin puanın" placement="left">
                <Box sx={{ ...badgeSx, color: "#FBBF24" }}>
                  <StarIcon sx={{ fontSize: 12 }} />
                  <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, lineHeight: 1 }}>{score}</Typography>
                </Box>
              </Tooltip>
            )}
            {malScore > 0 && (
              <Tooltip title="MyAnimeList puanı" placement="left">
                <Box sx={{ ...badgeSx, color: "#9DB8FF", border: "1px solid rgba(46,81,162,0.9)" }}>
                  <Box component="span" sx={{ fontSize: "0.56rem", fontWeight: 800, letterSpacing: "0.04em", px: 0.4, py: 0.1, borderRadius: "3px", color: "#fff", backgroundColor: "#2E51A2", lineHeight: 1.2 }}>
                    MAL
                  </Box>
                  <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, lineHeight: 1 }}>{malScore.toFixed(2)}</Typography>
                </Box>
              </Tooltip>
            )}
          </Box>
        )}

        {anime.PlanToWatch && (
          <Box sx={{ position: "absolute", top: 8, left: 8, zIndex: 2, color: "#F59E0B" }}>
            <BookmarkIcon sx={{ fontSize: 18, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} />
          </Box>
        )}

        {renderActions && (
          <Box
            className="anime-actions"
            onClick={(e) => e.stopPropagation()}
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 3,
              display: "flex",
              justifyContent: "center",
              py: 0.5,
              opacity: 0,
              transition: "opacity 0.25s ease",
              // backdrop-filter kullanılmaz: 3B eğimli kartta, grid'in kırpılan kenarlarına yakın kartlarda
              // Chrome bu katmanı düşürüp hover butonlarını gizleyebiliyor
              backgroundColor: "rgba(10,10,14,0.82)",
              borderRadius: "0 0 10px 10px",
            }}
          >
            {renderActions(anime)}
          </Box>
        )}

        <Box
          className="anime-overlay"
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            borderRadius: "10px",
            background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
            opacity: 0,
            transition: "opacity 0.25s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            p: 1.5,
            pb: renderActions ? 6 : 1.5,
            pointerEvents: "none",
          }}
        >
          <Typography
            sx={{
              color: "#fff",
              fontWeight: 700,
              fontSize: gridSize <= 6 ? "0.8rem" : "0.7rem",
              lineHeight: 1.2,
              mb: 0.8,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {anime.Name}
          </Typography>
          <Chip
            label={status.label}
            size="small"
            sx={{
              alignSelf: "flex-start",
              backgroundColor: alpha(status.color, 0.18),
              color: status.color,
              fontWeight: 700,
              height: 20,
              fontSize: "0.65rem",
              borderRadius: "6px",
            }}
          />
        </Box>
      </Box>
    </Box>
  );
});

function SkeletonCards({ count, gridSize }: { count: number; gridSize: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} sx={{ width: `${100 / gridSize}%`, p: 1, flexShrink: 0 }}>
          <Skeleton
            variant="rounded"
            animation="wave"
            sx={{ width: "100%", height: "auto", aspectRatio: "2/3", borderRadius: "10px", bgcolor: alpha(palette.overlay, 0.05) }}
          />
        </Box>
      ))}
    </>
  );
}

export default function AnimeGrid({
  allData,
  loading,
  loadingMore,
  gridSize,
  onLoadMore,
  renderActions,
}: AnimeGridProps) {
  const [selectedAnime, setSelectedAnime] = useState<TEATable.IAnime | null>(null);
  const [usedTransition, setUsedTransition] = useState(false);
  // Açık modalın kaynak kartı: kapanışta kapak buraya geri uçar
  const sourceCover = useRef<HTMLElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);

  const openDetail = useCallback((anime: TEATable.IAnime, cover: HTMLElement | null) => {
    sourceCover.current = cover;
    const supported = "startViewTransition" in document && !prefersReducedMotion();
    if (cover && supported) cover.style.viewTransitionName = COVER_TRANSITION_NAME;
    const vt = withViewTransition(() => {
      // Aynı isim iki elemanda olamaz: yeni durumda isim modal posterine geçer
      if (cover) cover.style.viewTransitionName = "";
      setUsedTransition(supported);
      setSelectedAnime(anime);
    });
    vt?.finished.catch(() => {});
  }, []);

  const closeDetail = useCallback(() => {
    const cover = sourceCover.current;
    const vt = withViewTransition(() => {
      setSelectedAnime(null);
      if (cover && cover.isConnected) cover.style.viewTransitionName = COVER_TRANSITION_NAME;
    });
    const cleanup = () => {
      if (cover) cover.style.viewTransitionName = "";
    };
    if (vt) vt.finished.then(cleanup, cleanup);
    else cleanup();
  }, []);

  const closeImmediately = useCallback(() => setSelectedAnime(null), []);

  // Reset loadingMore ref when it changes
  useEffect(() => {
    if (!loadingMore) {
      isLoadingMoreRef.current = false;
    }
  }, [loadingMore]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    // Son sayfadayken tetiklenen istek hiçbir şey yüklemez; bayrak takılı kalırsa liste değişince
    // (ör. arama temizlenince) sonsuz kaydırma durur. Yeni gözlemciyle birlikte bayrak gerçek duruma döner.
    isLoadingMoreRef.current = loadingMore;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMoreRef.current && !loading) {
          isLoadingMoreRef.current = true;
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-observe after each batch: if the sentinel is still on screen (wide grids),
    // the fresh observer fires again and keeps filling the viewport.
  }, [onLoadMore, loading, loadingMore, allData.length]);

  const initialLoading = loading && allData.length === 0;
  // Hızlı (ör. boş sonuç) yüklemelerde iskelet bir anlığına görünüp kaybolmasın
  const showSkeleton = useDelayedFlag(initialLoading);

  if (!initialLoading && (!allData || allData.length === 0)) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, justifyContent: "center", alignItems: "center", height: "100%", color: alpha(palette.overlay, 0.4) }}>
        <Typography sx={{ color: alpha(palette.overlay, 0.8), fontWeight: 600 }}>Sonuç yok</Typography>
        <Typography sx={{ fontSize: "0.85rem" }}>Filtreleri değiştirip tekrar dene.</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        p: 2,
        "&::-webkit-scrollbar": { width: "6px" },
        "&::-webkit-scrollbar-track": { backgroundColor: "transparent" },
        "&::-webkit-scrollbar-thumb": { backgroundColor: alpha(palette.overlay, 0.1), borderRadius: "4px" },
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0, mx: -1 }}>
        {initialLoading ? (
          showSkeleton && <SkeletonCards count={gridSize * 3} gridSize={gridSize} />
        ) : (
          allData.map((anime, index) => (
            <AnimeCard
              key={anime.ID || `anime-${index}`}
              anime={anime}
              gridSize={gridSize}
              onSelect={openDetail}
              renderActions={renderActions}
            />
          ))
        )}
        {loadingMore && <SkeletonCards count={gridSize} gridSize={gridSize} />}
      </Box>

      {/* Sentinel div for IntersectionObserver */}
      <Box ref={sentinelRef} sx={{ height: 60 }} />

      {selectedAnime && (
        <AnimeDetailModal
          anime={selectedAnime}
          onClose={closeDetail}
          onActionClose={closeImmediately}
          renderActions={renderActions}
          viewTransition={usedTransition}
        />
      )}
    </Box>
  );
}
