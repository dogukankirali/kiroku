"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Autocomplete, Box, Button, IconButton, Slider, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import TvRoundedIcon from "@mui/icons-material/TvRounded";
import LocalMoviesRoundedIcon from "@mui/icons-material/LocalMoviesRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import UploadRoundedIcon from "@mui/icons-material/UploadRounded";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import BookmarkAddedRoundedIcon from "@mui/icons-material/BookmarkAddedRounded";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import HourglassTopRoundedIcon from "@mui/icons-material/HourglassTopRounded";
import { Field, Segmented, TextInput, fieldBg, fieldBorder } from "../ui/FormControls";
import { GenreChip, genreLabel } from "../Common/GenreChip";
import { palette } from "../../theme/customTheme";
import { AnimeService } from "../../Services/AnimeServices";
import WatchDateFields from "./WatchDates";

// Alanlar API ile aynı adlarda; IAnime tipleri (ör. Score: string) gerçek veriyle örtüşmediği için gevşek tutuldu
export type AnimeDraft = Record<string, any>;

const STATUS_OPTIONS = [
  { value: "Finished", label: "Tamamlandı" },
  { value: "Currently Airing", label: "Yayında" },
  { value: "Not yet aired", label: "Henüz yayınlanmadı" },
  { value: "Unknown", label: "Bilinmiyor" },
];

type SeriesOption = { id: number; name: string };

const autocompleteSx = {
  "& .MuiInputBase-root": {
    minHeight: 40,
    py: "3px !important",
    px: "8px !important",
    borderRadius: "10px",
    border: fieldBorder,
    backgroundColor: fieldBg,
    fontSize: "0.9rem",
    "&.Mui-focused": { borderColor: alpha(palette.primary, 0.6) },
  },
  "& .MuiOutlinedInput-notchedOutline": { border: 0 },
};

const listboxPaper = {
  paper: {
    sx: {
      mt: 0.5,
      backgroundColor: palette.surfaceRaised,
      border: fieldBorder,
      borderRadius: "10px",
      "& .MuiAutocomplete-option": { fontSize: "0.88rem" },
    },
  },
};

/**
 * Anime oluşturma/düzenleme formu. `value` alanları API ile aynı adlarda (Name, Genre, Series...).
 * `onChange` yalnızca değişen alanları alır.
 */
export default function AnimeForm({
  value,
  onChange,
  genres,
  readOnly,
  catalogLocked,
}: {
  value: AnimeDraft;
  onChange: (patch: AnimeDraft) => void;
  genres: { value: string; label: string }[];
  readOnly?: boolean;
  /** Admin olmayan kullanıcı: yalnızca kendi bölüm, puan, watchlist ve notlarını değiştirir (#39) */
  catalogLocked?: boolean;
}) {
  const lockCatalog = readOnly || catalogLocked;
  const fileRef = useRef<HTMLInputElement>(null);
  const [series, setSeries] = useState<SeriesOption[]>([]);
  const [coverUrlDraft, setCoverUrlDraft] = useState("");

  useEffect(() => {
    AnimeService.getSeries().then((list: any[]) =>
      setSeries((list ?? []).map((s) => ({ id: Number(s.id), name: String(s.name ?? s.label ?? "") })))
    );
  }, []);

  const total = Number(value.TotalNumberOfEpisodes) || 0;
  const watched = Math.max(0, Number(value.WatchStatus) || 0);
  const score = Number(value.Score) > 0 ? Number(value.Score) : 0;
  const cover = typeof value.Cover === "string" && value.Cover ? value.Cover : "";

  const selectedGenres = useMemo(
    () =>
      String(value.Genre ?? "")
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean),
    [value.Genre]
  );
  const genreOptions = useMemo(() => {
    const names = new Set(genres.map((g) => g.value));
    // DB'de olmayan (aramadan gelen) türleri de gösterebilmek için seçili olanları ekle
    return [...genres.map((g) => g.value), ...selectedGenres.filter((g) => !names.has(g))];
  }, [genres, selectedGenres]);

  const selectedSeries = series.find((s) => s.id === Number(value.Series)) ?? null;
  const statusOptions = STATUS_OPTIONS.some((o) => o.value === value.AnimeStatus) || !value.AnimeStatus
    ? STATUS_OPTIONS
    : [...STATUS_OPTIONS, { value: String(value.AnimeStatus), label: String(value.AnimeStatus) }];

  const onFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onChange({ Cover: reader.result as string });
    reader.readAsDataURL(file);
  };

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px minmax(0, 1fr)" }, gap: 3 }}>
      {/* Kapak */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        <Box
          sx={{
            position: "relative",
            aspectRatio: "2 / 3",
            borderRadius: "12px",
            overflow: "hidden",
            border: fieldBorder,
            backgroundColor: palette.surfaceRaised,
            display: "grid",
            placeItems: "center",
            maxWidth: { xs: 160, sm: "none" },
          }}
        >
          {cover ? (
            <img src={cover} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Box sx={{ textAlign: "center", color: palette.textFaint }}>
              <ImageOutlinedIcon sx={{ fontSize: 32 }} />
              <Typography sx={{ fontSize: "0.75rem" }}>Kapak yok</Typography>
            </Box>
          )}
        </Box>
        {!lockCatalog && (
          <>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <Button
              size="small"
              variant="outlined"
              startIcon={<UploadRoundedIcon />}
              onClick={() => fileRef.current?.click()}
              sx={{ borderColor: alpha(palette.overlay, 0.12), color: palette.text }}
            >
              Görsel yükle
            </Button>
            <TextInput
              placeholder="ya da görsel URL'si"
              value={coverUrlDraft}
              onChange={(e) => setCoverUrlDraft(e.target.value)}
              onBlur={() => {
                if (coverUrlDraft.trim()) {
                  onChange({ Cover: coverUrlDraft.trim() });
                  setCoverUrlDraft("");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              sx={{ fontSize: "0.8rem", minHeight: 34 }}
            />
          </>
        )}
      </Box>

      {/* Alanlar */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, alignContent: "start" }}>
        <Field label="İsim" sx={{ gridColumn: "1 / -1" }}>
          <TextInput value={value.Name ?? ""} onChange={(e) => onChange({ Name: e.target.value })} disabled={lockCatalog} placeholder="Anime adı" autoFocus={!readOnly && !value.Name} />
        </Field>

        <Field label="Yayın durumu">
          <Autocomplete
            disableClearable
            options={statusOptions}
            value={statusOptions.find((o) => o.value === value.AnimeStatus) ?? statusOptions[0]}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.value === b.value}
            onChange={(_, o) => onChange({ AnimeStatus: o.value })}
            disabled={lockCatalog}
            slotProps={listboxPaper}
            sx={autocompleteSx}
            renderInput={(params) => <TextFieldLike params={params} />}
          />
        </Field>

        <Field label="Format">
          <Segmented
            value={Boolean(value.IsMovie)}
            disabled={lockCatalog}
            onChange={(v) => onChange({ IsMovie: v })}
            options={[
              { value: false, label: <><TvRoundedIcon /> TV</> },
              { value: true, label: <><LocalMoviesRoundedIcon /> Film</> },
            ]}
          />
        </Field>

        <Field
          label="İzlenen bölüm"
          hint={total > 0 ? `${Math.min(watched, total)} / ${total}` : undefined}
        >
          <TextInput
            type="number"
            value={watched}
            onChange={(e) => onChange({ WatchStatus: Math.max(0, Number(e.target.value)) })}
            disabled={readOnly}
            inputProps={{ min: 0, max: total || undefined }}
            endAdornmentNode={
              !readOnly && total > 0 && watched < total ? (
                <Tooltip title="Tamamlandı olarak işaretle">
                  <IconButton size="small" onClick={() => onChange({ WatchStatus: total })} sx={{ color: palette.success, mr: -0.75 }}>
                    <DoneAllRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : undefined
            }
          />
        </Field>

        <Field label="Toplam bölüm">
          <TextInput
            type="number"
            value={total}
            onChange={(e) => onChange({ TotalNumberOfEpisodes: Math.max(0, Number(e.target.value)) })}
            disabled={lockCatalog}
            inputProps={{ min: 0 }}
          />
        </Field>

        <Field label="Puanın" hint={score > 0 ? `${score} / 100` : "Puanlanmadı"} sx={{ gridColumn: "1 / -1" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, px: 1 }}>
            <Slider
              value={score}
              min={0}
              max={100}
              step={1}
              disabled={readOnly}
              onChange={(_, v) => onChange({ Score: v as number })}
              sx={{ flex: 1 }}
              aria-label="Puan"
            />
            <TextInput
              type="number"
              value={score}
              onChange={(e) => onChange({ Score: Math.min(100, Math.max(0, Number(e.target.value))) })}
              disabled={readOnly}
              inputProps={{ min: 0, max: 100 }}
              sx={{ width: 76, flex: "none" }}
            />
          </Box>
        </Field>

        <Field label="Türler" sx={{ gridColumn: "1 / -1" }}>
          <Autocomplete
            multiple
            disableCloseOnSelect
            options={genreOptions}
            value={selectedGenres}
            getOptionLabel={(g) => genreLabel(g)}
            onChange={(_, list) => onChange({ Genre: list.join(", ") })}
            disabled={lockCatalog}
            slotProps={listboxPaper}
            sx={autocompleteSx}
            renderTags={(list, getTagProps) =>
              list.map((g, index) => {
                const { key, onDelete } = getTagProps({ index });
                return (
                  <Box key={key} component="span" sx={{ m: "2px", display: "inline-flex" }} onClick={lockCatalog ? undefined : onDelete}>
                    <GenreChip genre={g} active />
                  </Box>
                );
              })
            }
            renderInput={(params) => <TextFieldLike params={params} placeholder={selectedGenres.length ? "" : "Tür seç…"} />}
          />
        </Field>

        <Field label="Seri">
          <Autocomplete
            options={series}
            value={selectedSeries}
            getOptionLabel={(s) => s.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_, s) => onChange({ Series: s ? s.id : 0, SeriesName: s ? s.name : "" })}
            disabled={lockCatalog}
            slotProps={listboxPaper}
            sx={autocompleteSx}
            renderInput={(params) => <TextFieldLike params={params} placeholder="Seri yok" />}
          />
        </Field>

        <Field label="MAL puanı">
          <TextInput
            type="number"
            value={Number(value.MALScore) || 0}
            onChange={(e) => onChange({ MALScore: Number(e.target.value) })}
            disabled={lockCatalog}
            inputProps={{ min: 0, max: 10, step: 0.01 }}
          />
        </Field>

        <Field label="Watchlist" sx={{ gridColumn: "1 / -1" }}>
          <Segmented
            value={Boolean(value.PlanToWatch)}
            disabled={readOnly}
            onChange={(v) => onChange({ PlanToWatch: v })}
            options={[
              { value: false, label: <><BookmarkBorderRoundedIcon /> Listede değil</> },
              { value: true, label: <><BookmarkAddedRoundedIcon /> İzlenecekler listesinde</> },
            ]}
          />
        </Field>

        <Field label="Waitlist" hint="Yayınlanmasını beklediklerin" sx={{ gridColumn: "1 / -1" }}>
          <Segmented
            value={Boolean(value.WaitList)}
            disabled={readOnly}
            onChange={(v) => onChange({ WaitList: v })}
            options={[
              { value: false, label: <>Waitlist'te değil</> },
              { value: true, label: <><HourglassTopRoundedIcon /> Waitlist'te</> },
            ]}
          />
        </Field>

        {/* Tarihler kullanıcının kendi kaydına ait; yalnızca var olan animeyi düzenlerken */}
        {value.ID ? (
          <WatchDateFields startedAt={value.StartedAt} finishedAt={value.FinishedAt} disabled={readOnly} onChange={onChange} />
        ) : null}

        <LinkField label="İzleme linki" value={value.AnimeLink ?? ""} readOnly={lockCatalog} onChange={(v) => onChange({ AnimeLink: v })} />
        <LinkField label="MAL sayfası" value={value.MALAnimeLink ?? ""} readOnly={lockCatalog} onChange={(v) => onChange({ MALAnimeLink: v })} />

        <Field label="Notlar" sx={{ gridColumn: "1 / -1" }}>
          <TextInput multiline minRows={3} value={value.Notes ?? ""} onChange={(e) => onChange({ Notes: e.target.value })} disabled={readOnly} placeholder="Kendine not…" />
        </Field>
      </Box>
    </Box>
  );
}

// Autocomplete'in input'unu diğer alanlarla aynı görünümde tutar
function TextFieldLike({ params, placeholder }: { params: any; placeholder?: string }) {
  const { InputProps, inputProps } = params;
  return (
    <Box ref={InputProps.ref} className={`MuiInputBase-root ${InputProps.className ?? ""}`} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.25 }}>
      {InputProps.startAdornment}
      <Box
        component="input"
        {...inputProps}
        placeholder={placeholder}
        sx={{ flex: 1, minWidth: 60, border: 0, outline: 0, background: "transparent", color: palette.text, font: "inherit", fontSize: "0.9rem", py: 0.75, px: 0.5 }}
      />
      {InputProps.endAdornment}
    </Box>
  );
}

function LinkField({ label, value, onChange, readOnly }: { label: string; value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <Field label={label}>
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        placeholder="https://…"
        endAdornmentNode={
          value ? (
            <Tooltip title="Yeni sekmede aç">
              <IconButton size="small" component="a" href={value} target="_blank" rel="noopener noreferrer" sx={{ color: palette.textMuted, mr: -0.75 }}>
                <OpenInNewRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
    </Field>
  );
}
