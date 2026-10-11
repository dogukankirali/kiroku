"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Skeleton,
  Snackbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import BookmarksOutlinedIcon from "@mui/icons-material/BookmarksOutlined";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { API_URL } from "../../constants/Constants";
import { palette } from "../../theme/customTheme";
import { useDelayedFlag } from "../../lib/useDelayedFlag";

interface AnimeData {
  ID: number;
  Name: string;
  Cover: string;
  AnimeStatus: string;
  Score: number;
  MALScore: number;
  WatchStatus: number;
  TotalNumberOfEpisodes: number;
  IsMovie: boolean;
  PlanToWatch: boolean;
  AnimeLink?: string;
}

interface WatchListItem {
  id: number;
  anime_id: number;
  order_rank: number;
  anime: AnimeData;
}

type Toast = { severity: "success" | "error"; text: string } | null;

function WatchlistRow({
  item,
  index,
  onRemove,
  onComplete,
}: {
  item: WatchListItem;
  index: number;
  onRemove: (item: WatchListItem) => void;
  onComplete: (animeId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id.toString(),
  });
  const anime = item.anime;
  const total = Number(anime?.TotalNumberOfEpisodes) || 0;
  const watched = anime?.WatchStatus > 0 ? anime.WatchStatus : 0;
  const router = useRouter();
  const watchLink = anime?.AnimeLink && /^https?:\/\//i.test(anime.AnimeLink) ? anime.AnimeLink : "";
  const openDetail = () => router.push(`/anime/detail?id=${anime.ID}`);

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        p: 1.25,
        pr: 2,
        borderRadius: "14px",
        backgroundColor: isDragging ? palette.surfaceRaised : palette.surface,
        border: `1px solid ${isDragging ? alpha(palette.primary, 0.5) : alpha(palette.overlay, 0.06)}`,
        boxShadow: isDragging ? "0 18px 40px rgba(0,0,0,0.45)" : "none",
        position: "relative",
        zIndex: isDragging ? 2 : "auto",
        transition: "background-color .15s ease, border-color .15s ease",
        "&:hover": { backgroundColor: palette.surfaceRaised, "& .row-actions": { opacity: 1 } },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        aria-label="Sürükleyerek sırala"
        sx={{
          display: "flex",
          alignItems: "center",
          color: palette.textFaint,
          cursor: "grab",
          touchAction: "none",
          "&:active": { cursor: "grabbing" },
          "&:hover": { color: palette.textMuted },
        }}
      >
        <DragIndicatorRoundedIcon fontSize="small" />
      </Box>

      <Typography sx={{ width: 28, textAlign: "center", fontWeight: 700, fontSize: "1.05rem", color: index < 3 ? palette.primary : palette.textMuted }}>
        {index + 1}
      </Typography>

      <Box
        onClick={openDetail}
        sx={{
          cursor: "pointer",
          width: 52,
          height: 74,
          borderRadius: "8px",
          overflow: "hidden",
          flexShrink: 0,
          backgroundColor: palette.surfaceRaised,
        }}
      >
        {anime?.Cover && (
          <img src={anime.Cover} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap onClick={openDetail} sx={{ fontWeight: 600, fontSize: "0.95rem", mb: 0.5, cursor: "pointer", "&:hover": { color: palette.primary } }}>
          {anime?.Name ?? "İsimsiz anime"}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Chip size="small" label={anime?.IsMovie ? "Film" : `${total || "?"} bölüm`} sx={{ height: 22, fontSize: "0.7rem", backgroundColor: alpha(palette.overlay, 0.06) }} />
          {anime?.AnimeStatus && (
            <Chip size="small" label={anime.AnimeStatus} sx={{ height: 22, fontSize: "0.7rem", backgroundColor: alpha(palette.overlay, 0.06) }} />
          )}
          {anime?.MALScore > 0 && (
            <Chip
              size="small"
              icon={<StarRoundedIcon sx={{ fontSize: "14px !important", color: `${palette.warning} !important` }} />}
              label={`MAL ${anime.MALScore}`}
              sx={{ height: 22, fontSize: "0.7rem", backgroundColor: alpha(palette.warning, 0.12), color: palette.warning }}
            />
          )}
        </Box>
        {watched > 0 && total > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.75, maxWidth: 280 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (watched / total) * 100)}
              sx={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: alpha(palette.overlay, 0.06) }}
            />
            <Typography sx={{ fontSize: "0.7rem", color: palette.textMuted }}>
              {watched}/{total}
            </Typography>
          </Box>
        )}
      </Box>

      <Box className="row-actions" sx={{ display: "flex", gap: 0.5, opacity: { xs: 1, md: 0.6 }, transition: "opacity .15s ease" }}>
        {watchLink && (
          <Tooltip title="İzleme linkini aç">
            <IconButton component="a" href={watchLink} target="_blank" rel="noopener noreferrer" sx={{ color: palette.primary }}>
              <PlayCircleOutlineRoundedIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="İzledim, tamamla">
          <IconButton onClick={() => onComplete(item.anime.ID)} sx={{ color: palette.success }}>
            <CheckCircleOutlineRoundedIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Listeden çıkar">
          <IconButton onClick={() => onRemove(item)} sx={{ color: palette.textMuted, "&:hover": { color: palette.danger } }}>
            <DeleteOutlineRoundedIcon />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default function WatchListPage() {
  const router = useRouter();
  const [watchList, setWatchList] = useState<WatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Hızlı (ör. boş) yüklemelerde iskelet bir anlığına görünüp kaybolmasın
  const showSkeleton = useDelayedFlag(loading);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState<Toast>(null);

  // silent: arka plan yenilemesinde iskelet gösterme (sekmeye dönüşte vb.)
  const fetchWatchList = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await axios.get<WatchListItem[]>(`${API_URL}/watchlist`);
      setWatchList(response.data ?? []);
      setLoadError("");
    } catch (err: any) {
      setLoadError(`Watchlist alınamadı: ${err.message || "Bilinmeyen hata"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchList();
    // Watchlist backend'de PTW ile otomatik senkron; extension veya başka sekmeden
    // eklenenler sayfaya dönüldüğünde sessizce yenilenir.
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchWatchList(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchWatchList]);

  const removeFromWatchList = async (item: WatchListItem) => {
    const previous = watchList;
    setWatchList((list) => list.filter((i) => i.id !== item.id));
    try {
      await axios.delete(`${API_URL}/watchlist?id=${item.id}`);
      setToast({ severity: "success", text: `“${item.anime?.Name}” listeden çıkarıldı` });
    } catch (err: any) {
      setWatchList(previous);
      setToast({ severity: "error", text: `Silinemedi: ${err.message || "Bilinmeyen hata"}` });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Sürükle-bırak sonrası tüm sıraları 1..n olarak yeniden yaz; yalnızca değişenleri gönder
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = watchList.findIndex((i) => i.id.toString() === active.id);
    const newIndex = watchList.findIndex((i) => i.id.toString() === over.id);
    const previous = watchList;
    const reordered = arrayMove(watchList, oldIndex, newIndex).map((item, idx) => ({ ...item, order_rank: idx + 1 }));
    setWatchList(reordered);

    const changed = reordered.filter((item) => previous.find((p) => p.id === item.id)?.order_rank !== item.order_rank);
    try {
      // Tüm değişen sıralar tek istekte, tek D1 batch'inde yazılır
      if (changed.length) {
        await axios.put(`${API_URL}/watchlist/order`, changed.map((item) => ({ id: item.id, order_rank: item.order_rank })));
      }
    } catch (err: any) {
      setToast({ severity: "error", text: `Sıralama kaydedilemedi: ${err.message || "Bilinmeyen hata"}` });
      fetchWatchList(true);
    }
  };

  const completeAnime = (animeId: number) => {
    router.push(`/anime?id=${animeId}&edit=true&fromWatchList=true`);
  };

  return (
    <Box sx={{ maxWidth: 980, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.015em" }}>Sıradaki izlemeler</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>
            {loading ? "Yükleniyor…" : `${watchList.length} anime sırada · sürükleyerek sıralayabilirsin`}
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => router.push("/anime")} sx={{ borderColor: alpha(palette.overlay, 0.12), color: palette.text }}>
          Anime arşivine git
        </Button>
      </Box>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => fetchWatchList()}>Tekrar dene</Button>}>
          {loadError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {showSkeleton && Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: "14px", bgcolor: alpha(palette.overlay, 0.04) }} />
          ))}
        </Box>
      ) : watchList.length === 0 && !loadError ? (
        <Box
          sx={{
            textAlign: "center",
            py: 8,
            px: 3,
            borderRadius: "16px",
            border: `1px dashed ${alpha(palette.overlay, 0.12)}`,
            backgroundColor: alpha(palette.surface, 0.6),
          }}
        >
          <BookmarksOutlinedIcon sx={{ fontSize: 44, color: palette.primary, mb: 1.5 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Watchlist'in boş</Typography>
          <Typography sx={{ color: palette.textMuted, fontSize: "0.875rem", mb: 3 }}>
            Anime arşivinde ya da tarayıcı eklentisinde “Watchlist'e ekle” dediğin animeler burada otomatik görünür.
          </Typography>
          <Button variant="contained" onClick={() => router.push("/anime")}>
            Anime keşfet
          </Button>
        </Box>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={watchList.map((item) => item.id.toString())} strategy={verticalListSortingStrategy}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
              {watchList.map((item, index) => (
                <WatchlistRow key={item.id} item={item} index={index} onRemove={removeFromWatchList} onComplete={completeAnime} />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert onClose={() => setToast(null)} severity={toast.severity} variant="filled" sx={{ width: "100%" }}>
            {toast.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
