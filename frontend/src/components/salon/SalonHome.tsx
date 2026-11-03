"use client";

// Salon landing (/salon without an anime): a poster grid of the anime whose folder exists in the video library,
// with the half-watched ones ("Devam et") on top. Anime without a matching folder are picked from their own page.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Box, Skeleton, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { AnimeService } from "../../Services/AnimeServices";
import { palette } from "../../theme/customTheme";
import { stateList, stateSync } from "../../lib/userState";
import { listVideoLibrary, loadVideoLibrary, localFolderName, matchFolder } from "../../lib/videoLibrary";

type Anime = { id: number; name: string; english: string; cover: string };
type Resume = { animeId: number; title: string; cover?: string; ep?: string; label?: string; pos: number; dur: number; t: number };

const gridCols = { xs: "repeat(3, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))", md: "repeat(5, minmax(0, 1fr))", lg: "repeat(7, minmax(0, 1fr))" };

function Poster({ href, cover, title, sub, progress }: { href: string; cover: string; title: string; sub?: string; progress?: number }) {
  return (
    <Box component={Link} href={href} sx={{ textDecoration: "none", color: "inherit" }}>
      <Box sx={{ position: "relative", aspectRatio: "2/3", borderRadius: "14px", overflow: "hidden", backgroundColor: palette.surface, mb: 0.75, transition: "transform .15s ease", "&:hover": { transform: "translateY(-2px)" } }}>
        {cover && <img src={cover} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
        {progress !== undefined && (
          <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: alpha(palette.ink, 0.6) }}>
            <Box sx={{ width: `${Math.min(100, Math.max(0, progress * 100))}%`, height: "100%", backgroundColor: palette.primary }} />
          </Box>
        )}
      </Box>
      <Typography noWrap sx={{ fontSize: "0.8rem", fontWeight: 500 }}>{title}</Typography>
      {sub && <Typography noWrap sx={{ fontSize: "0.72rem", color: palette.textMuted }}>{sub}</Typography>}
    </Box>
  );
}

export default function SalonHome() {
  const [animes, setAnimes] = useState<Anime[] | null>(null);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [resume, setResume] = useState<Resume[]>([]);

  useEffect(() => {
    const load = () => setResume(stateList<Resume>("salon.cont:").sort((a, b) => b.t - a.t).slice(0, 7));
    load();
    stateSync("salon.cont:").then(load);
  }, []);

  useEffect(() => {
    let alive = true;
    const cfg = loadVideoLibrary();
    if (cfg.kind === "http" ? !cfg.url : !localFolderName()) {
      setError("Video kütüphanesi henüz bağlı değil. Bir animenin Salon sayfasından kütüphaneyi bağla, sonra burada hepsi görünür.");
      setFolders([]);
    } else {
      listVideoLibrary("")
        .then((entries) => alive && setFolders(entries.filter((e) => e.isDir).map((e) => e.name)))
        .catch((e) => {
          if (!alive) return;
          setError(`Video kütüphanesine ulaşılamadı: ${String(e?.message ?? e)}`);
          setFolders([]);
        });
    }
    AnimeService.getAnimes({ page: 1, count: 1000, filters: [] }).then((res) => {
      if (!alive) return;
      const rows = (res?.data ?? []) as (TEATable.IAnime & Record<string, any>)[];
      setAnimes(rows.map((a) => ({ id: a.ID, name: String(a.Name), cover: a.Cover || "", english: String(a.EnglishName ?? "") })));
    });
    return () => {
      alive = false;
    };
  }, []);

  const matched = useMemo(() => {
    if (!animes || !folders) return null;
    return animes.filter((a) => matchFolder(a.id, [a.name, a.english], folders));
  }, [animes, folders]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (matched ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [matched, query]);

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto" }}>
      {error && <Alert severity="info" sx={{ mb: 2 }}>{error}</Alert>}

      {resume.length > 0 && (
        <>
          <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", mb: 1.5 }}>Devam et</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: gridCols, gap: 2, mb: 4 }}>
            {resume.map((r) => (
              <Poster key={r.animeId} href={`/salon?id=${r.animeId}${r.ep ? `&ep=${encodeURIComponent(r.ep)}` : ""}`} cover={r.cover ?? ""} title={r.title} sub={r.label} progress={r.dur ? r.pos / r.dur : 0} />
            ))}
          </Box>
        </>
      )}

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1.5, flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1.05rem" }}>Kütüphanende bulunanlar{matched ? ` (${matched.length})` : ""}</Typography>
        <TextField size="small" placeholder="Ara…" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ minWidth: 200 }} />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: gridCols, gap: 2 }}>
        {matched === null
          ? Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} variant="rounded" sx={{ aspectRatio: "2/3", height: "auto", borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />)
          : shown.map((a) => <Poster key={a.id} href={`/salon?id=${a.id}`} cover={a.cover} title={a.name} />)}
      </Box>
      {matched && !shown.length && !error && <Typography sx={{ color: palette.textMuted, fontSize: "0.875rem" }}>Kütüphanedeki klasörlerle eşleşen anime bulunamadı. Klasör adı animenin adıyla aynıysa kendiliğinden eşleşir; değilse animenin Salon sayfasından klasörü seç.</Typography>}
    </Box>
  );
}
