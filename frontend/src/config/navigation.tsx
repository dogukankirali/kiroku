import type { ReactNode } from "react";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import MovieOutlinedIcon from "@mui/icons-material/MovieOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import LiveTvOutlinedIcon from "@mui/icons-material/LiveTvOutlined";
import TheatersOutlinedIcon from "@mui/icons-material/TheatersOutlined";
import BookmarksOutlinedIcon from "@mui/icons-material/BookmarksOutlined";
import HourglassTopRoundedIcon from "@mui/icons-material/HourglassTopRounded";
import BookmarkAddedOutlinedIcon from "@mui/icons-material/BookmarkAddedOutlined";

export interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  description?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Genel",
    items: [{ label: "Ana Sayfa", href: "/", icon: <HomeOutlinedIcon /> }],
  },
  {
    title: "Kütüphane",
    items: [
      { label: "Anime", href: "/anime", icon: <MovieOutlinedIcon />, description: "İzlediğin ve izleyeceğin animeler" },
      { label: "Manga", href: "/manga", icon: <MenuBookOutlinedIcon />, description: "Okuma listen" },
      { label: "Kitaplar", href: "/book", icon: <AutoStoriesOutlinedIcon />, description: "Kitap arşivin" },
      { label: "Diziler", href: "/series", icon: <LiveTvOutlinedIcon />, description: "Dizi takibi" },
      { label: "Filmler", href: "/movies", icon: <TheatersOutlinedIcon />, description: "Film arşivin" },
    ],
  },
  {
    title: "Takip",
    items: [
      { label: "Watchlist", href: "/watchlist", icon: <BookmarksOutlinedIcon />, description: "Sıradaki izlemeler" },
      { label: "Waitlist", href: "/waitlist", icon: <HourglassTopRoundedIcon />, description: "Yayınlanmasını beklediklerin" },
      { label: "Readlist", href: "/readlist", icon: <BookmarkAddedOutlinedIcon />, description: "Sıradaki okumalar" },
    ],
  },
];

const extraTitles: Record<string, string> = {
  "/profile": "Profil",
  "/login": "Giriş",
  "/register": "Kayıt Ol",
  "/forgot-password": "Şifremi Unuttum",
};

export function isNavItemActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function getPageTitle(pathname: string): string {
  for (const section of navSections) {
    const item = section.items.find((i) => isNavItemActive(pathname, i.href));
    if (item) return item.label;
  }
  const extra = Object.keys(extraTitles).find((p) => pathname.startsWith(p));
  return extra ? extraTitles[extra] : "Kiroku";
}
