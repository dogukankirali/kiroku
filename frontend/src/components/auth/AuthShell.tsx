"use client";

import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import { palette } from "../../theme/customTheme";
import axios from "axios";
import { API_BASE } from "../../Services/http";

// Sol panelde kayan kapak mozaiği: en yüksek puanlı animeler. Liste giriş istediği için mozaik
// herkese açık /anime-showcase'ten beslenir; alınamazsa yalnızca renkli arka plan kalır.
const MOSAIC_CACHE_KEY = "kirokuMosaicCovers";
const MOSAIC_TTL_MS = 24 * 60 * 60 * 1000;

function readMosaicCache(count: number): string[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(MOSAIC_CACHE_KEY) || "null");
    if (raw && Date.now() - raw.at < MOSAIC_TTL_MS && Array.isArray(raw.covers) && raw.covers.length >= count) return raw.covers.slice(0, count);
  } catch {}
  return null;
}

// Liste tarayıcıda bir gün saklanır: giriş sayfası her açıldığında istek atılmaz
function useMosaicCovers(count: number) {
  const [covers, setCovers] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const cached = readMosaicCache(count);
    if (cached) {
      setCovers(cached);
      return;
    }
    axios
      .get<string[]>(`${API_BASE}/anime-showcase`, { params: { count } })
      .then((res) => {
        const list = (Array.isArray(res.data) ? res.data : []).filter((c) => typeof c === "string" && c);
        if (list.length) {
          try {
            localStorage.setItem(MOSAIC_CACHE_KEY, JSON.stringify({ at: Date.now(), covers: list }));
          } catch {}
        }
        if (alive) setCovers(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [count]);
  return covers;
}

function CoverColumn({ covers, duration, reverse }: { covers: string[]; duration: number; reverse?: boolean }) {
  // Liste iki kez yan yana: -50% kaydırınca kesintisiz döngü olur
  const doubled = [...covers, ...covers];
  return (
    <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
      <motion.div
        animate={{ y: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
        transition={{ duration, ease: "linear", repeat: Infinity }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {doubled.map((src, i) => (
          <Box
            key={i}
            sx={{ aspectRatio: "2 / 3", borderRadius: "8px", overflow: "hidden", backgroundColor: alpha(palette.overlay, 0.04) }}
          >
            <img src={src} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </Box>
        ))}
      </motion.div>
    </Box>
  );
}

function Showcase() {
  const covers = useMosaicCovers(24);
  const cols = [0, 1, 2, 3].map((c) => covers.filter((_, i) => i % 4 === c));

  return (
    <Box
      sx={{
        position: "relative",
        display: { xs: "none", md: "block" },
        flex: "1 1 55%",
        overflow: "hidden",
        borderRight: `1px solid ${alpha(palette.overlay, 0.06)}`,
        background: `radial-gradient(90% 70% at 20% 10%, ${alpha(palette.primary, 0.35)} 0%, transparent 60%),
          radial-gradient(70% 60% at 90% 90%, ${alpha(palette.accent, 0.25)} 0%, transparent 60%), ${palette.ink}`,
      }}
    >
      {covers.length >= 8 && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: "-10% -15%",
            display: "flex",
            gap: 1.5,
            transform: "rotate(-8deg)",
            opacity: 0.55,
            "@media (prefers-reduced-motion: reduce)": { "& > div > div": { animation: "none", transform: "none !important" } },
          }}
        >
          {cols.map((c, i) => (
            <CoverColumn key={i} covers={c} duration={60 + i * 12} reverse={i % 2 === 1} />
          ))}
        </Box>
      )}
      {/* Okunurluk için mozaiğin üstünde koyu degrade */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to top, ${palette.ink} 0%, ${alpha(palette.ink, 0.75)} 35%, ${alpha(palette.ink, 0.2)} 100%)`,
        }}
      />
      <Box sx={{ position: "absolute", left: 48, right: 48, bottom: 48 }}>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.1 }}>
          <Typography sx={{ fontSize: "2.4rem", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, color: palette.text }}>
            İzlediğin her şey,
            <br />
            tek bir arşivde.
          </Typography>
          <Typography sx={{ mt: 1.5, color: palette.textMuted, maxWidth: 440, lineHeight: 1.6 }}>
            Anime, manga, kitap ve dizilerini puanla, ilerlemeni takip et, izleme listeni düzenle.
          </Typography>
        </motion.div>
      </Box>
    </Box>
  );
}

export function Brand() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: "11px",
          display: "grid",
          placeItems: "center",
          color: "#fff",
          background: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.accent} 100%)`,
          boxShadow: `0 6px 18px ${alpha(palette.primary, 0.35)}`,
        }}
      >
        <StorageRoundedIcon sx={{ fontSize: 20 }} />
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", lineHeight: 1.1, letterSpacing: "-0.01em" }}>Kiroku</Typography>
        <Typography sx={{ fontSize: "0.72rem", color: palette.textMuted }}>記録 · medya arşivi</Typography>
      </Box>
    </Box>
  );
}

/** Giriş / kayıt / şifre sayfaları için ortak iki sütunlu düzen */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", minHeight: "100vh", backgroundColor: palette.ink }}>
      <Showcase />
      <Box
        sx={{
          flex: "1 1 45%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          px: { xs: 2.5, sm: 6 },
          py: 5,
          background: { xs: `radial-gradient(80% 50% at 50% 0%, ${alpha(palette.primary, 0.18)} 0%, transparent 70%)`, md: "none" },
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          style={{ width: "100%", maxWidth: 380 }}
        >
          <Brand />
          <Typography component="h1" sx={{ mt: 5, fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em", color: palette.text }}>
            {title}
          </Typography>
          {subtitle && <Typography sx={{ mt: 0.75, mb: 3.5, color: palette.textMuted, fontSize: "0.92rem" }}>{subtitle}</Typography>}
          {!subtitle && <Box sx={{ mb: 3.5 }} />}
          {children}
          {footer && <Box sx={{ mt: 3.5, fontSize: "0.88rem", color: palette.textMuted, textAlign: "center" }}>{footer}</Box>}
        </motion.div>
      </Box>
    </Box>
  );
}

export const authLinkSx = {
  color: palette.primary,
  fontWeight: 600,
  textDecoration: "none",
  "&:hover": { textDecoration: "underline" },
} as const;
