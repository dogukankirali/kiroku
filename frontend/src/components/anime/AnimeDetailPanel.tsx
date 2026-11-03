"use client";

import { formatWatchDate } from "./WatchDates";
import React from "react";
import { motion } from "motion/react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { GenreChips } from "../Common/GenreChip";
import { useCoverColor } from "../../hooks/useCoverColor";
import { hexToRgbTriplet, palette } from "../../theme/customTheme";
import { ANIME_STATUS_TR, Pill, SalonLink, Stat, formatNextEpisode, getCoverSrc, getStatusInfo } from "./AnimeDetailModal";

/** Tabloda satır genişletilince görünen özet paneli */
export default function AnimeDetailPanel({ data }: { data: TEATable.IAnime; update?: unknown }) {
  const a = data as TEATable.IAnime & Record<string, any>;
  const imgSrc = getCoverSrc(a.Cover);
  const rgb = useCoverColor(imgSrc) ?? hexToRgbTriplet(palette.primary);
  const status = getStatusInfo(data);
  const watched = Number(a.WatchStatus) || 0;
  const total = parseInt(String(a.TotalNumberOfEpisodes)) || 0;
  const progress = total > 0 ? Math.min(100, (watched / total) * 100) : 0;
  const score = Number(a.Score) || 0;
  const malScore = Number(a.MALScore) || 0;
  const links = [
    { href: a.AnimeLink, label: "İzleme linki" },
    { href: a.MALAnimeLink, label: "MyAnimeList" },
  ].filter((l) => typeof l.href === "string" && /^https?:\/\//.test(l.href));

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 34 }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: { xs: 2, sm: 2.5 },
          p: 2,
          borderRadius: "10px",
          border: `1px solid ${alpha(palette.overlay, 0.06)}`,
          backgroundColor: alpha(palette.overlay, 0.02),
          backgroundImage: `radial-gradient(80% 120% at 0% 0%, rgba(${rgb}, 0.16) 0%, transparent 60%)`,
          textAlign: "left",
        }}
      >
        <Box
          sx={{
            flexShrink: 0,
            width: 110,
            alignSelf: { xs: "center", sm: "flex-start" },
            aspectRatio: "2 / 3",
            borderRadius: "8px",
            overflow: "hidden",
            backgroundColor: palette.surfaceRaised,
            boxShadow: `0 10px 28px rgba(0,0,0,0.45), 0 0 40px -12px rgba(${rgb}, 0.6)`,
          }}
        >
          {imgSrc && <img src={imgSrc} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1.75 }}>
          {a.EnglishName && a.EnglishName !== a.Name && (
            <Typography sx={{ fontSize: "0.85rem", color: palette.textMuted, mb: -0.75 }}>
              <Box component="span" sx={{ fontSize: "0.68rem", color: palette.textFaint, textTransform: "uppercase", letterSpacing: "0.06em", mr: 1 }}>
                İngilizce
              </Box>
              {a.EnglishName}
            </Typography>
          )}
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
            <Pill color={status.color}>{status.label}</Pill>
            <Pill color={a.IsMovie ? "#34D399" : "#F472B6"}>{a.IsMovie ? "Film" : "TV"}</Pill>
            {a.AnimeStatus && <Pill color={palette.textMuted}>{ANIME_STATUS_TR[a.AnimeStatus] ?? a.AnimeStatus}</Pill>}
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, minmax(0, 1fr))" }, gap: 2 }}>
            <Stat label="Puanım">
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.4 }}>
                <StarRoundedIcon sx={{ fontSize: 16, color: "#FBBF24" }} />
                {score > 0 ? `${score} / 100` : "Puanlanmadı"}
              </Box>
            </Stat>
            <Stat label="MAL">{malScore > 0 ? malScore.toFixed(2) : "—"}</Stat>
            <Stat label="Seri">{a.SeriesName || "—"}</Stat>
            <Stat label="Bölüm">{total > 0 ? total : "?"}</Stat>
            {formatNextEpisode(data) && <Stat label="Sıradaki bölüm">{formatNextEpisode(data)}</Stat>}
            <Stat label="Başladım">{formatWatchDate(a.StartedAt)}</Stat>
            <Stat label="Bitirdim">{formatWatchDate(a.FinishedAt)}</Stat>
          </Box>

          {total > 0 && (
            <Box sx={{ maxWidth: 520 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>İlerleme</Typography>
                <Typography sx={{ fontSize: "0.72rem", color: palette.text, fontWeight: 600 }}>
                  {watched} / {total} bölüm
                </Typography>
              </Box>
              <Box sx={{ height: 5, borderRadius: 3, backgroundColor: alpha(palette.overlay, 0.08), overflow: "hidden" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.1 }}
                  style={{ height: "100%", borderRadius: 3, background: progress >= 100 ? palette.success : `linear-gradient(90deg, ${palette.primary}, #60A5FA)` }}
                />
              </Box>
            </Box>
          )}

          {a.Genre && (Array.isArray(a.Genre) ? a.Genre.length > 0 : String(a.Genre).trim()) && (
            <GenreChips genres={a.Genre} max={12} justify="flex-start" />
          )}

          {a.Notes && (
            <Typography sx={{ fontSize: "0.82rem", color: palette.textMuted, lineHeight: 1.55, whiteSpace: "pre-wrap", maxWidth: 760 }}>{a.Notes}</Typography>
          )}

          {true && (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
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
                <Box
                  key={l.label}
                  component="a"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    height: 28,
                    px: 1.25,
                    borderRadius: "7px",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    color: palette.text,
                    textDecoration: "none",
                    backgroundColor: alpha(palette.overlay, 0.05),
                    border: `1px solid ${alpha(palette.overlay, 0.08)}`,
                    "&:hover": { backgroundColor: alpha(palette.overlay, 0.09) },
                  }}
                >
                  {l.label}
                  <OpenInNewRoundedIcon sx={{ fontSize: 13, color: palette.textMuted }} />
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </motion.div>
  );
}
