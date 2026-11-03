"use client";

import { formatWatchDate } from "./WatchDates";
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import BookmarkRoundedIcon from "@mui/icons-material/BookmarkRounded";
import { GenreChips } from "../Common/GenreChip";
import { useCoverColor } from "../../hooks/useCoverColor";
import { hexToRgbTriplet, palette } from "../../theme/customTheme";

/** Grid kartı ile modal posteri arasında View Transition için kullanılan ortak isim */
export const COVER_TRANSITION_NAME = "kiroku-cover";

export function getCoverSrc(cover?: string): string | null {
  if (!cover) return null;
  if (cover.startsWith("http") || cover.startsWith("data:") || cover.startsWith("/")) return cover;
  return `data:image/jpeg;base64,${cover}`;
}

export function getStatusInfo(anime: TEATable.IAnime) {
  if (anime.PlanToWatch) return { label: "İzlenecek", color: palette.warning };
  const w = Number(anime.WatchStatus) || 0;
  const total = parseInt(String(anime.TotalNumberOfEpisodes)) || 0;
  if (w > 0 && total > 0 && w >= total) return { label: "Tamamlandı", color: palette.success };
  if (w > 0) return { label: `${w}. bölümde`, color: "#60A5FA" };
  return { label: "Başlanmadı", color: palette.textMuted };
}

export const ANIME_STATUS_TR: Record<string, string> = {
  Finished: "Bitti",
  "Currently Airing": "Yayında",
  "Not yet aired": "Yayınlanmadı",
  Unknown: "Bilinmiyor",
};

// İçerik blokları sırayla, yaylı bir şekilde gelir
const stagger = { show: { transition: { staggerChildren: 0.045, delayChildren: 0.08 } } };
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 420, damping: 32 } },
};

export function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        height: 24,
        px: 1,
        borderRadius: "6px",
        fontSize: "0.72rem",
        fontWeight: 600,
        color,
        backgroundColor: alpha(color, 0.12),
        border: `1px solid ${alpha(color, 0.25)}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Box>
  );
}

export function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: "0.68rem", color: palette.textFaint, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ fontSize: "0.9rem", fontWeight: 600, color: palette.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </Box>
    </Box>
  );
}

/** Yayın takibi (#19): "6. bölüm · 13 Eki 17:00" (yerel saat); bilinmiyorsa null */
export function formatNextEpisode(anime: Partial<TEATable.IAnime>): string | null {
  if (!anime.NextEpisode || !anime.NextEpisodeAt) return null;
  const at = new Date(anime.NextEpisodeAt);
  if (Number.isNaN(at.getTime())) return null;
  const when = at.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${anime.NextEpisode}. bölüm · ${when}`;
}

export default function AnimeDetailModal({
  anime,
  onClose,
  onActionClose,
  renderActions,
  viewTransition = false,
}: {
  anime: TEATable.IAnime;
  /** Açılış View Transition ile yapılıyorsa kabuk kendi giriş animasyonunu atlar (poster yerinde ölçülsün) */
  viewTransition?: boolean;
  /** Animasyonlu kapanış (kapak karta geri uçar) */
  onClose: () => void;
  /** Düzenle/sil gibi aksiyonlarda anında kapanış, üstüne başka modal açılacağı için */
  onActionClose: () => void;
  renderActions?: (anime: TEATable.IAnime) => React.ReactNode;
}) {
  const a = anime as TEATable.IAnime & Record<string, any>;
  const imgSrc = getCoverSrc(a.Cover);
  const rgb = useCoverColor(imgSrc);
  const glow = rgb ?? hexToRgbTriplet(palette.primary);
  const status = getStatusInfo(anime);
  const watched = Number(a.WatchStatus) || 0;
  const total = parseInt(String(a.TotalNumberOfEpisodes)) || 0;
  const progress = total > 0 ? Math.min(100, (watched / total) * 100) : 0;
  const score = Number(a.Score) || 0;
  const malScore = Number(a.MALScore) || 0;
  const nextEpisode = formatNextEpisode(anime);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const links = [
    { href: a.AnimeLink, label: "İzleme linki" },
    { href: a.MALAnimeLink, label: "MyAnimeList" },
  ].filter((l) => typeof l.href === "string" && /^https?:\/\//.test(l.href));

  return createPortal(
    <Box
      role="dialog"
      aria-modal="true"
      aria-label={a.Name}
      onClick={onClose}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        display: "flex",
        alignItems: { xs: "flex-end", sm: "center" },
        justifyContent: "center",
        p: { xs: 0, sm: 3 },
        backgroundColor: "rgba(6,6,10,0.72)",
        backdropFilter: "blur(6px)",
      }}
    >
      <motion.div
        initial={viewTransition ? false : { opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 780, maxHeight: "100%", display: "flex" }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            maxHeight: { xs: "92vh", sm: "min(640px, calc(100vh - 48px))" },
            overflow: "auto",
            borderRadius: { xs: "14px 14px 0 0", sm: "14px" },
            border: `1px solid ${alpha(palette.overlay, 0.08)}`,
            backgroundColor: palette.surface,
            boxShadow: `0 30px 80px rgba(0,0,0,0.6), 0 0 120px -20px rgba(${glow}, 0.35)`,
            // Kapağın baskın renginden ortam ışığı
            backgroundImage: `radial-gradient(120% 70% at 15% 0%, rgba(${glow}, 0.28) 0%, rgba(${glow}, 0.08) 40%, transparent 70%)`,
          }}
        >
          <IconButton
            onClick={onClose}
            aria-label="Kapat"
            size="small"
            sx={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 2,
              color: palette.textMuted,
              backgroundColor: alpha("#000000", 0.35),
              "&:hover": { backgroundColor: alpha("#000000", 0.6), color: palette.text },
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>

          <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: { xs: 2, sm: 3 }, p: { xs: 2, sm: 3 } }}>
            {/* Poster: grid kartından buraya uçar (View Transition) */}
            <Box
              sx={{
                flexShrink: 0,
                width: { xs: 140, sm: 220 },
                alignSelf: { xs: "center", sm: "flex-start" },
                aspectRatio: "2 / 3",
                borderRadius: "10px",
                overflow: "hidden",
                backgroundColor: palette.surfaceRaised,
                boxShadow: `0 18px 40px rgba(0,0,0,0.55), 0 0 0 1px ${alpha(palette.overlay, 0.06)}`,
                viewTransitionName: COVER_TRANSITION_NAME,
              }}
            >
              {imgSrc && <img src={imgSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
            </Box>

            <motion.div variants={stagger} initial="hidden" animate="show" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              <motion.div variants={item}>
                <Typography component="h2" sx={{ fontSize: { xs: "1.2rem", sm: "1.45rem" }, fontWeight: 800, lineHeight: 1.2, pr: 5, color: palette.text }}>
                  {a.Name}
                </Typography>
                {a.EnglishName && a.EnglishName !== a.Name && (
                  <Typography sx={{ mt: 0.5, pr: 5, fontSize: "0.92rem", color: palette.textMuted, lineHeight: 1.3 }}>{a.EnglishName}</Typography>
                )}
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1.25 }}>
                  <Pill color={status.color}>
                    {a.PlanToWatch && <BookmarkRoundedIcon sx={{ fontSize: 14 }} />}
                    {status.label}
                  </Pill>
                  <Pill color={a.IsMovie ? "#34D399" : "#F472B6"}>{a.IsMovie ? "Film" : "TV"}</Pill>
                  {a.AnimeStatus && <Pill color={palette.textMuted}>{ANIME_STATUS_TR[a.AnimeStatus] ?? a.AnimeStatus}</Pill>}
                </Box>
              </motion.div>

              <motion.div variants={item}>
                <Box sx={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
                  <Box>
                    <Typography sx={{ fontSize: "0.68rem", color: palette.textFaint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Puanım</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <StarRoundedIcon sx={{ color: "#FBBF24", fontSize: 26 }} />
                      <Typography sx={{ fontSize: "1.8rem", fontWeight: 800, lineHeight: 1, color: palette.text }}>{score > 0 ? score : <Box component="span" sx={{ fontSize: "1rem", fontWeight: 600, color: palette.textMuted }}>Puanlanmadı</Box>}</Typography>
                      {score > 0 && <Typography sx={{ color: palette.textFaint, fontSize: "0.85rem", alignSelf: "flex-end", mb: 0.25 }}>/100</Typography>}
                    </Box>
                  </Box>
                  <Stat label="MAL">{malScore > 0 ? malScore.toFixed(2) : "—"}</Stat>
                </Box>
              </motion.div>

              {total > 0 && (
                <motion.div variants={item}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.75 }}>
                    <Typography sx={{ fontSize: "0.75rem", color: palette.textMuted }}>İlerleme</Typography>
                    <Typography sx={{ fontSize: "0.75rem", color: palette.text, fontWeight: 600 }}>
                      {watched} / {total} bölüm
                    </Typography>
                  </Box>
                  <Box sx={{ height: 6, borderRadius: 3, backgroundColor: alpha(palette.overlay, 0.08), overflow: "hidden" }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.15 }}
                      style={{ height: "100%", borderRadius: 3, background: progress >= 100 ? palette.success : `linear-gradient(90deg, ${palette.primary}, #60A5FA)` }}
                    />
                  </Box>
                </motion.div>
              )}

              <motion.div variants={item}>
                <Box sx={{ display: "grid", gridTemplateColumns: nextEpisode ? "1fr 1fr 1fr" : "1fr 1fr", gap: 2 }}>
                  <Stat label="Seri">{a.SeriesName || "—"}</Stat>
                  <Stat label="Bölüm">{total > 0 ? total : "?"}</Stat>
                  {nextEpisode && <Stat label="Sıradaki bölüm">{nextEpisode}</Stat>}
                </Box>
              </motion.div>

              <motion.div variants={item}>
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  <Stat label="Başladım">{formatWatchDate(a.StartedAt)}</Stat>
                  <Stat label="Bitirdim">{formatWatchDate(a.FinishedAt)}</Stat>
                </Box>
              </motion.div>

              {a.Genre && (Array.isArray(a.Genre) ? a.Genre.length > 0 : String(a.Genre).trim()) && (
                <motion.div variants={item}>
                  <GenreChips genres={a.Genre} max={12} justify="flex-start" />
                </motion.div>
              )}

              {a.Notes && (
                <motion.div variants={item}>
                  <Box sx={{ p: 1.5, borderRadius: "8px", backgroundColor: alpha(palette.overlay, 0.035), border: `1px solid ${alpha(palette.overlay, 0.05)}` }}>
                    <Typography sx={{ fontSize: "0.68rem", color: palette.textFaint, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }}>Notlar</Typography>
                    <Typography sx={{ fontSize: "0.85rem", color: palette.textMuted, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{a.Notes}</Typography>
                  </Box>
                </motion.div>
              )}

              {(true) && (
                <motion.div variants={item}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", pt: 0.5 }}>
                    <Box
                      component="a"
                      href={`/anime/detail?id=${a.ID}`}
                      onClick={(e: React.MouseEvent) => {
                        // Modal/satır tıklama işleyicileri istemci içi geçişi yutabiliyor; geçişi doğrudan yap
                        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
                        e.preventDefault();
                        e.stopPropagation();
                        window.location.assign(`/anime/detail?id=${a.ID}`);
                      }}
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.5,
                        height: 30,
                        px: 1.25,
                        borderRadius: "8px",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: palette.onPrimary,
                        textDecoration: "none",
                        backgroundColor: palette.primary,
                        "&:hover": { backgroundColor: palette.primaryHover },
                      }}
                    >
                      Detay sayfası
                    </Box>
              <SalonLink id={a.ID} />
                    {links.map((l) => (
                      <Tooltip key={l.label} title={l.href}>
                        <Box
                          component="a"
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 0.5,
                            height: 30,
                            px: 1.25,
                            borderRadius: "8px",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: palette.text,
                            textDecoration: "none",
                            backgroundColor: alpha(palette.overlay, 0.05),
                            border: `1px solid ${alpha(palette.overlay, 0.08)}`,
                            "&:hover": { backgroundColor: alpha(palette.overlay, 0.09) },
                          }}
                        >
                          {l.label}
                          <OpenInNewRoundedIcon sx={{ fontSize: 14, color: palette.textMuted }} />
                        </Box>
                      </Tooltip>
                    ))}
                    <Box sx={{ flex: 1 }} />
                    {renderActions && (
                      // Düzenle/sil modalı bu pencerenin üstüne binmesin diye önce bu kapanır
                      <Box onClickCapture={onActionClose} sx={{ display: "flex" }}>
                        {renderActions(anime)}
                      </Box>
                    )}
                  </Box>
                </motion.div>
              )}
            </motion.div>
          </Box>
        </Box>
      </motion.div>
    </Box>,
    document.body
  );
}

/** "Salon'da izle" button shared by the grid modal and the table panel */
export function SalonLink({ id }: { id: number }) {
  const href = `/salon?id=${id}`;
  return (
    <Box
      component="a"
      href={href}
      onClick={(e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        window.location.assign(href);
      }}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        height: 30,
        px: 1.25,
        borderRadius: "8px",
        fontSize: "0.8rem",
        fontWeight: 600,
        color: palette.text,
        textDecoration: "none",
        backgroundColor: alpha(palette.overlay, 0.07),
        border: `1px solid ${alpha(palette.overlay, 0.1)}`,
        "&:hover": { backgroundColor: alpha(palette.overlay, 0.12) },
      }}
    >
      Salon'da izle
    </Box>
  );
}
