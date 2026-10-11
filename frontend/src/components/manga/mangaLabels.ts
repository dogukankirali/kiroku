import { palette } from "../../theme/customTheme";
import type { Chapter, ReadStatus } from "../../Services/MangaService";

export const READ_STATUS_LABEL: Record<Exclude<ReadStatus, "">, string> = {
  READING: "Okuyorum",
  COMPLETED: "Bitirdim",
  PAUSED: "Ara verdim",
  DROPPED: "Bıraktım",
  PLANNING: "Okuyacağım",
};

export const READ_STATUS_COLOR: Record<Exclude<ReadStatus, "">, string> = {
  READING: palette.info,
  COMPLETED: palette.success,
  PAUSED: palette.warning,
  DROPPED: palette.danger,
  PLANNING: palette.accent,
};

export const PUB_STATUS_LABEL: Record<string, string> = {
  RELEASING: "Devam ediyor",
  FINISHED: "Tamamlandı",
  HIATUS: "Ara verildi",
  CANCELLED: "İptal",
  NOT_YET_RELEASED: "Yayınlanmadı",
};

export const FORMAT_LABEL: Record<string, string> = { MANGA: "Manga", NOVEL: "Light novel", ONE_SHOT: "One-shot" };

export const progressText = (read: number, total: number) => `${read}/${total || "?"}`;

export const chapterLabel = (ch: Pick<Chapter, "number" | "title" | "volume">) =>
  `${ch.volume ? `Cilt ${ch.volume} · ` : ""}Bölüm ${ch.number}${ch.title ? ` — ${ch.title}` : ""}`;

export const READ_FORMAT_LABEL: Record<"DIGITAL" | "PHYSICAL", string> = { DIGITAL: "Dijital", PHYSICAL: "Fiziksel" };
