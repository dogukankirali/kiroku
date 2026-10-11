"use client";

// Readlist (/readlist): the user's Plan to Read queue, kept in sync with user_manga.plan_to_read by D1 triggers.
// Same interaction as the anime watchlist: drag to reorder, remove, jump to the manga.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Skeleton, Snackbar, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MangaService, errorText, type ReadlistItem } from "../../Services/MangaService";
import { PUB_STATUS_LABEL } from "../../components/manga/mangaLabels";
import { palette } from "../../theme/customTheme";
import { useDelayedFlag } from "../../lib/useDelayedFlag";

function Row({ item, index, onRemove }: { item: ReadlistItem; index: number; onRemove: (i: ReadlistItem) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(item.id) });
  const m = item.manga;
  return (
    <Box ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{ display: "flex", alignItems: "center", gap: 2, p: 1.25, pr: 2, borderRadius: "14px", position: "relative", zIndex: isDragging ? 2 : "auto",
        backgroundColor: isDragging ? palette.surfaceRaised : palette.surface, border: `1px solid ${alpha(isDragging ? palette.primary : palette.overlay, isDragging ? 0.5 : 0.06)}` }}>
      <Box {...attributes} {...listeners} aria-label="Sürükleyerek sırala" sx={{ display: "flex", color: palette.textFaint, cursor: "grab", touchAction: "none" }}>
        <DragIndicatorRoundedIcon fontSize="small" />
      </Box>
      <Typography sx={{ width: 28, textAlign: "center", fontWeight: 700, color: index < 3 ? palette.primary : palette.textMuted }}>{index + 1}</Typography>
      <Box sx={{ width: 52, height: 74, borderRadius: "8px", overflow: "hidden", flexShrink: 0, backgroundColor: palette.surfaceRaised }}>
        {m.cover && <img src={m.cover} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.95rem", mb: 0.5 }}>{m.name}</Typography>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          <Chip size="small" label={`${m.totalChapters || "?"} bölüm`} sx={{ height: 22, fontSize: "0.7rem" }} />
          {m.status && <Chip size="small" label={PUB_STATUS_LABEL[m.status] ?? m.status} sx={{ height: 22, fontSize: "0.7rem" }} />}
          {m.malScore > 0 && (
            <Chip size="small" icon={<StarRoundedIcon sx={{ fontSize: "14px !important" }} />} label={m.malScore.toFixed(1)}
              sx={{ height: 22, fontSize: "0.7rem", backgroundColor: alpha(palette.warning, 0.12), color: palette.warning }} />
          )}
        </Box>
        {m.chaptersRead > 0 && m.totalChapters > 0 && (
          <LinearProgress variant="determinate" value={Math.min(100, (m.chaptersRead / m.totalChapters) * 100)} sx={{ mt: 0.75, maxWidth: 280, height: 4, borderRadius: 2 }} />
        )}
      </Box>
      <Tooltip title="Listeden çıkar">
        <IconButton onClick={() => onRemove(item)} sx={{ color: palette.textMuted, "&:hover": { color: palette.danger } }}>
          <DeleteOutlineRoundedIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function ReadlistPage() {
  const [items, setItems] = useState<ReadlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Hızlı (ör. boş) yüklemelerde iskelet bir anlığına görünüp kaybolmasın
  const showSkeleton = useDelayedFlag(loading);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ severity: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setItems(await MangaService.readlist.list());
      setError("");
    } catch (e) {
      setError(`Okuma listesi alınamadı: ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const previous = items;
    const reordered = arrayMove(items, items.findIndex((i) => String(i.id) === active.id), items.findIndex((i) => String(i.id) === over.id)).map((it, idx) => ({ ...it, orderRank: idx + 1 }));
    setItems(reordered);
    const changed = reordered.filter((it) => previous.find((p) => p.id === it.id)?.orderRank !== it.orderRank);
    try {
      if (changed.length) await MangaService.readlist.reorder(changed.map(({ id, orderRank }) => ({ id, orderRank })));
    } catch (e) {
      setToast({ severity: "error", text: `Sıralama kaydedilemedi: ${errorText(e)}` });
      load(true);
    }
  };

  const remove = async (item: ReadlistItem) => {
    const previous = items;
    setItems((l) => l.filter((i) => i.id !== item.id));
    try {
      await MangaService.readlist.remove(item.id);
      setToast({ severity: "success", text: `“${item.manga.name}” listeden çıkarıldı` });
    } catch (e) {
      setItems(previous);
      setToast({ severity: "error", text: `Silinemedi: ${errorText(e)}` });
    }
  };

  return (
    <Box sx={{ maxWidth: 980, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 700 }}>Sıradaki okumalar</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: palette.textMuted }}>{loading ? "Yükleniyor…" : `${items.length} manga sırada · sürükleyerek sıralayabilirsin`}</Typography>
        </Box>
        <Button component={Link} href="/manga" variant="outlined">Manga arşivine git</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {showSkeleton && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: "14px" }} />)}
        </Box>
      ) : !items.length && !error ? (
        <Box sx={{ textAlign: "center", py: 8, borderRadius: "16px", border: `1px dashed ${alpha(palette.overlay, 0.12)}` }}>
          <AutoStoriesOutlinedIcon sx={{ fontSize: 44, color: palette.primary, mb: 1.5 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Okuma listen boş</Typography>
          <Typography sx={{ color: palette.textMuted, fontSize: "0.875rem", mb: 3 }}>Manga arşivinde “Plan to Read” işaretlediğin mangalar burada görünür.</Typography>
          <Button component={Link} href="/manga" variant="contained">Manga keşfet</Button>
        </Box>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => String(i.id))} strategy={verticalListSortingStrategy}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
              {items.map((item, i) => <Row key={item.id} item={item} index={i} onRemove={remove} />)}
            </Box>
          </SortableContext>
        </DndContext>
      )}
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {toast ? <Alert onClose={() => setToast(null)} severity={toast.severity} variant="filled">{toast.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
