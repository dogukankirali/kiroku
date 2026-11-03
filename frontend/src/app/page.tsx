"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Box, ButtonBase, Skeleton, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { navSections } from "../config/navigation";
import { API_URL } from "../constants/Constants";
import { AnimeService } from "../Services/AnimeServices";
import { useAuth } from "../contexts/AuthContext";
import { palette } from "../theme/customTheme";
import { stateList, stateSync } from "../lib/userState";

interface WatchItem {
  id: number;
  anime: { ID: number; Name: string; Cover: string };
}

// Half-watched episodes and half-read chapters (written by the Salon player and the manga reader, synced per account)
interface ContinueItem {
  kind: "watch" | "read";
  title: string;
  cover: string;
  detail: string;
  progress: number;
  href: string;
  t: number;
}

function loadContinue(): ContinueItem[] {
  const watch = stateList<{ animeId: number; title: string; cover?: string; ep?: string; label?: string; pos: number; dur: number; t: number }>("salon.cont:").map(
    (w): ContinueItem => ({ kind: "watch", title: w.title, cover: w.cover ?? "", detail: w.label ?? "", progress: w.dur ? w.pos / w.dur : 0, href: `/salon?id=${w.animeId}${w.ep ? `&ep=${encodeURIComponent(w.ep)}` : ""}`, t: w.t })
  );
  const read = stateList<{ mangaId: number; title: string; cover?: string; chapterId: number; number: number; page: number; count: number; t: number }>("read.cont:").map(
    (r): ContinueItem => ({ kind: "read", title: r.title, cover: r.cover ?? "", detail: `Bölüm ${r.number} · sayfa ${r.page + 1}/${r.count}`, progress: r.count ? (r.page + 1) / r.count : 0, href: `/manga/read?id=${r.mangaId}&ch=${r.chapterId}`, t: r.t })
  );
  return [...watch, ...read].sort((a, b) => b.t - a.t).slice(0, 12);
}

const library = navSections.find((s) => s.title === "Kütüphane")?.items ?? [];

function StatCard({ label, value, href }: { label: string; value: number | null; href: string }) {
  return (
    <ButtonBase
      component={Link}
      href={href}
      sx={{
        display: "block",
        textAlign: "left",
        p: 2.5,
        borderRadius: "16px",
        backgroundColor: palette.surface,
        border: `1px solid ${alpha(palette.overlay, 0.06)}`,
        transition: "border-color .15s ease, transform .15s ease",
        "&:hover": { borderColor: alpha(palette.primary, 0.4), transform: "translateY(-2px)" },
      }}
    >
      <Typography sx={{ fontSize: "0.78rem", color: palette.textMuted, mb: 1 }}>{label}</Typography>
      {value === null ? (
        <Skeleton width={60} height={40} sx={{ bgcolor: alpha(palette.overlay, 0.06) }} />
      ) : (
        <Typography sx={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{value}</Typography>
      )}
    </ButtonBase>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const [animeCount, setAnimeCount] = useState<number | null>(null);
  const [watchlist, setWatchlist] = useState<WatchItem[] | null>(null);
  const [resume, setResume] = useState<ContinueItem[]>([]);

  useEffect(() => {
    setResume(loadContinue()); // local copy first (after hydration), then the account's copy
    Promise.all([stateSync("salon.cont:"), stateSync("read.cont:")]).then(() => setResume(loadContinue()));
  }, []);

  useEffect(() => {
    AnimeService.getAnimes({ page: 1, count: 1, filters: [] }).then((res) =>
      setAnimeCount(res?.pagination?.totalItemCount ?? 0)
    );
    axios
      .get<WatchItem[]>(`${API_URL}/watchlist`)
      .then((res) => setWatchlist(res.data ?? []))
      .catch(() => setWatchlist([]));
  }, []);

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto" }}>
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          p: { xs: 3, md: 4 },
          mb: 3,
          borderRadius: "20px",
          border: `1px solid ${alpha(palette.overlay, 0.06)}`,
          background: `radial-gradient(120% 140% at 0% 0%, ${alpha(palette.primary, 0.28)} 0%, transparent 55%), radial-gradient(90% 120% at 100% 100%, ${alpha(palette.accent, 0.16)} 0%, transparent 60%), ${palette.surface}`,
        }}
      >
        <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted, mb: 0.5 }}>
          {new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })}
        </Typography>
        <Typography sx={{ fontSize: { xs: "1.6rem", md: "2rem" }, fontWeight: 700, letterSpacing: "-0.025em", mb: 1 }}>
          {user?.username ? `Tekrar hoş geldin, ${user.username}` : "Hoş geldin"}
        </Typography>
        <Typography sx={{ color: palette.textMuted, maxWidth: 520 }}>
          Anime, manga, kitap ve dizilerini tek yerden takip et. Watchlist'in tarayıcı eklentisiyle otomatik güncellenir.
        </Typography>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", maxWidth: 640, gap: 2, mb: 4 }}>
        <StatCard label="Arşivdeki anime" value={animeCount} href="/anime" />
        <StatCard label="Watchlist'te bekleyen" value={watchlist ? watchlist.length : null} href="/watchlist" />
      </Box>

      {resume.length > 0 && (
        <>
          <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", mb: 1.5 }}>Devam et</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(3, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))", md: "repeat(6, minmax(0, 1fr))" }, gap: 2, mb: 4 }}>
            {resume.slice(0, 6).map((item) => (
              <Box key={`${item.kind}:${item.href}`} component={Link} href={item.href} sx={{ textDecoration: "none", color: "inherit" }}>
                <Box sx={{ position: "relative", aspectRatio: "2/3", borderRadius: "14px", overflow: "hidden", backgroundColor: palette.surface, mb: 1 }}>
                  {item.cover && <img src={item.cover} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                  <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: alpha(palette.ink, 0.6) }}>
                    <Box sx={{ width: `${Math.min(100, Math.max(0, item.progress * 100))}%`, height: "100%", backgroundColor: palette.primary }} />
                  </Box>
                </Box>
                <Typography noWrap sx={{ fontSize: "0.8rem", fontWeight: 500 }}>{item.title}</Typography>
                <Typography noWrap sx={{ fontSize: "0.72rem", color: palette.textMuted }}>{item.kind === "watch" ? "İzleniyor" : "Okunuyor"}{item.detail ? ` · ${item.detail}` : ""}</Typography>
              </Box>
            ))}
          </Box>
        </>
      )}

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1.05rem" }}>Sıradaki izlemeler</Typography>
        <ButtonBase component={Link} href="/watchlist" sx={{ gap: 0.5, fontSize: "0.82rem", color: palette.primary, borderRadius: 1, px: 1, py: 0.5 }}>
          Tümünü gör <ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />
        </ButtonBase>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(3, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))", md: "repeat(6, minmax(0, 1fr))" }, gap: 2, mb: 4 }}>
        {watchlist === null
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" sx={{ aspectRatio: "2/3", height: "auto", borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />
            ))
          : watchlist.slice(0, 6).map((item, i) => (
              <Box key={item.id} component={Link} href="/watchlist" sx={{ textDecoration: "none", color: "inherit" }}>
                <Box sx={{ position: "relative", aspectRatio: "2/3", borderRadius: "14px", overflow: "hidden", backgroundColor: palette.surface, mb: 1 }}>
                  {item.anime?.Cover && (
                    <img src={item.anime.Cover} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                  <Box
                    sx={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      minWidth: 24,
                      height: 24,
                      px: 0.75,
                      borderRadius: "8px",
                      display: "grid",
                      placeItems: "center",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      backgroundColor: alpha(palette.ink, 0.75),
                      backdropFilter: "blur(6px)",
                    }}
                  >
                    {i + 1}
                  </Box>
                </Box>
                <Typography noWrap sx={{ fontSize: "0.8rem", fontWeight: 500 }}>
                  {item.anime?.Name}
                </Typography>
              </Box>
            ))}
        {watchlist?.length === 0 && (
          <Typography sx={{ gridColumn: "1 / -1", color: palette.textMuted, fontSize: "0.875rem" }}>
            Watchlist'in boş. Anime arşivinden ya da eklentiden ekleyebilirsin.
          </Typography>
        )}
      </Box>

      <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", mb: 1.5 }}>Kütüphane</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 2 }}>
        {library.map((item) => (
          <ButtonBase
            key={item.href}
            component={Link}
            href={item.href}
            sx={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              flexDirection: "column",
              gap: 1.5,
              p: 2.5,
              textAlign: "left",
              borderRadius: "16px",
              backgroundColor: palette.surface,
              border: `1px solid ${alpha(palette.overlay, 0.06)}`,
              transition: "border-color .15s ease, transform .15s ease",
              "&:hover": { borderColor: alpha(palette.primary, 0.4), transform: "translateY(-2px)", "& .go": { opacity: 1, transform: "translateX(0)" } },
            }}
          >
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: "12px",
                display: "grid",
                placeItems: "center",
                color: palette.primary,
                backgroundColor: alpha(palette.primary, 0.12),
              }}
            >
              {item.icon}
            </Box>
            <Box sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{item.label}</Typography>
                <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>{item.description}</Typography>
              </Box>
              <ArrowForwardRoundedIcon className="go" sx={{ fontSize: 18, color: palette.textMuted, opacity: 0, transform: "translateX(-4px)", transition: "all .15s ease" }} />
            </Box>
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}
