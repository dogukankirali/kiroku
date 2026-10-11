"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Box, Drawer } from "@mui/material";
import Navbar from "./Navbar";
import Sidebar, { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from "./Sidebar";
import CommandPalette from "../CommandPalette";
import ProtectedRoute from "../auth/ProtectedRoute";

const COLLAPSED_KEY = "sidebarCollapsed";
const AUTH_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];
const PREWARM_ROUTES = ["/", "/anime", "/watchlist", "/readlist", "/profile", "/manga", "/book", "/series", "/movies", "/waitlist"];

// Masaüstünde sabit (daraltılabilir) sidebar, md altında açılır menü (drawer).
// Boyutlar JS yerine CSS breakpoint'leri ile yönetilir; ilk render'da kayma olmaz.
export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {}
  }, []);

  // Kapak görsellerini önbelleğe alan service worker (public/sw.js)
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker kaydedilemedi:", err));
    }
  }, []);

  // Yalnızca `next dev`: geliştirme sunucusu her sayfayı ilk ziyarette derliyor (kod değişince yeniden), bu da
  // ilk tıklamada birkaç saniyelik beklemeye ve tıklamanın işe yaramamış gibi görünmesine yol açıyordu.
  // Sayfa açıldıktan kısa süre sonra diğer sayfalar arka planda sırayla derletilir. Canlıda (statik çıktı) çalışmaz.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const route of PREWARM_ROUTES) {
        if (cancelled) return;
        await fetch(route, { headers: { Accept: "text/html" } }).catch(() => {});
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Sayfa değişince mobil menüyü kapat
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? "0" : "1");
      } catch {}
      return !prev;
    });
  };

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  // Giriş/kayıt sayfaları kendi tam ekran düzenini çizer
  if (pathname && AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return <>{children}</>;
  }

  return (
    <Box sx={{ minHeight: "100vh", backgroundColor: "background.default" }}>
      <Box
        sx={{
          display: { xs: "none", md: "block" },
          position: "fixed",
          inset: "0 auto 0 0",
          width: sidebarWidth,
          zIndex: (t) => t.zIndex.drawer,
          transition: "width .2s ease",
        }}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </Box>

      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { md: "none" }, "& .MuiDrawer-paper": { width: SIDEBAR_WIDTH, border: 0 } }}
      >
        <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <Box
        sx={{
          pl: { xs: 0, md: `${sidebarWidth}px` },
          transition: "padding-left .2s ease",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Navbar onMenuClick={() => setMobileOpen(true)} />
        <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 1.5, sm: 2, md: 3 } }}>
          {/* Listeler giriş ister (API de girişsiz okumaya kapalı); girişsiz ziyaretçi login'e yönlenir */}
          <ProtectedRoute>{children}</ProtectedRoute>
        </Box>
      </Box>
      <CommandPalette />
    </Box>
  );
}
