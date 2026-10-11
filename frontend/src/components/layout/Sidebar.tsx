"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, Box, ButtonBase, IconButton, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import { navSections, isNavItemActive } from "../../config/navigation";
import { palette } from "../../theme/customTheme";
import { useAuth } from "../../contexts/AuthContext";

export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 76;

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}

export function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    // Satır içi style, tarayıcı eklentilerinin değiştirdiği bir özellik olduğu için hydration uyuşmazlığı veriyordu; sx sınıf üretir
    <Box component={Link} href="/" sx={{ display: "block", textDecoration: "none", color: "inherit" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: collapsed ? 0 : 0.5, justifyContent: collapsed ? "center" : "flex-start" }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: "11px",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            color: "#fff",
            background: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.accent} 100%)`,
            boxShadow: `0 6px 18px ${alpha(palette.primary, 0.35)}`,
          }}
        >
          <StorageRoundedIcon sx={{ fontSize: 20 }} />
        </Box>
        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: "0.98rem", lineHeight: 1.1, letterSpacing: "-0.01em" }}>
              Kiroku
            </Typography>
            <Typography sx={{ fontSize: "0.7rem", color: "text.secondary" }}>記録 · medya arşivi</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function UserCard({ collapsed }: { collapsed: boolean }) {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    const button = (
      <ButtonBase
        component={Link}
        href="/login"
        sx={{
          width: "100%",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 1.25,
          px: collapsed ? 0 : 1.5,
          py: 1.1,
          borderRadius: "10px",
          color: "text.primary",
          fontSize: "0.85rem",
          fontWeight: 600,
          backgroundColor: alpha(palette.primary, 0.12),
          "&:hover": { backgroundColor: alpha(palette.primary, 0.2) },
        }}
      >
        <LoginRoundedIcon sx={{ fontSize: 20, color: palette.primary }} />
        {!collapsed && "Giriş yap"}
      </ButtonBase>
    );
    return collapsed ? <Tooltip title="Giriş yap" placement="right">{button}</Tooltip> : button;
  }

  const card = (
    <ButtonBase
      component={Link}
      href="/profile"
      sx={{
        width: "100%",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 1.25,
        p: collapsed ? 0.5 : 1,
        borderRadius: "12px",
        textAlign: "left",
        "&:hover": { backgroundColor: "action.hover" },
      }}
    >
      <Avatar sx={{ width: 34, height: 34, fontSize: "0.9rem", fontWeight: 700, bgcolor: alpha(palette.primary, 0.25), color: "#fff" }}>
        {user.username?.charAt(0).toUpperCase() || "U"}
      </Avatar>
      {!collapsed && (
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: 600 }}>
            {user.username}
          </Typography>
          <Typography noWrap sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
            {user.isAdmin ? "Yönetici" : "Kullanıcı"}
          </Typography>
        </Box>
      )}
    </ButtonBase>
  );
  return collapsed ? <Tooltip title={user.username} placement="right">{card}</Tooltip> : card;
}

export default function Sidebar({ collapsed, onToggleCollapsed, onNavigate }: SidebarProps) {
  const pathname = usePathname() || "/";

  return (
    <Box
      component="nav"
      aria-label="Ana menü"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        px: collapsed ? 1.25 : 1.75,
        py: 2,
        backgroundColor: palette.surface,
        borderRight: `1px solid ${alpha(palette.overlay, 0.06)}`,
      }}
    >
      <Box sx={{ mb: 3, mt: 0.5 }}>
        <Brand collapsed={collapsed} />
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {navSections.map((section) => (
          <Box key={section.title} sx={{ mb: 2 }}>
            {collapsed ? (
              <Box sx={{ height: 1, mx: 1.5, mb: 1.25, backgroundColor: alpha(palette.overlay, 0.06) }} />
            ) : (
              <Typography
                sx={{
                  px: 1.25,
                  mb: 0.75,
                  fontSize: "0.68rem",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: palette.textFaint,
                }}
              >
                {section.title}
              </Typography>
            )}
            {section.items.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              const link = (
                <ButtonBase
                  key={item.href}
                  component={Link}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  sx={{
                    position: "relative",
                    width: "100%",
                    height: 40,
                    mb: 0.5,
                    px: collapsed ? 0 : 1.25,
                    gap: 1.5,
                    justifyContent: collapsed ? "center" : "flex-start",
                    borderRadius: "10px",
                    color: active ? palette.text : palette.textMuted,
                    fontSize: "0.875rem",
                    fontWeight: active ? 600 : 500,
                    backgroundColor: active ? alpha(palette.primary, 0.14) : "transparent",
                    transition: "background-color .15s ease, color .15s ease",
                    "& svg": { fontSize: 21, color: active ? palette.primary : "inherit", transition: "color .15s ease" },
                    "&:hover": {
                      color: palette.text,
                      backgroundColor: active ? alpha(palette.primary, 0.18) : alpha(palette.overlay, 0.04),
                    },
                    "&::before": active
                      ? {
                          content: '""',
                          position: "absolute",
                          left: collapsed ? -10 : -14,
                          top: 10,
                          bottom: 10,
                          width: 3,
                          borderRadius: "0 3px 3px 0",
                          backgroundColor: palette.primary,
                        }
                      : undefined,
                  }}
                >
                  {item.icon}
                  {!collapsed && <span>{item.label}</span>}
                </ButtonBase>
              );
              return collapsed ? (
                <Tooltip key={item.href} title={item.label} placement="right">
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          </Box>
        ))}
      </Box>

      <Box sx={{ pt: 1.5, borderTop: `1px solid ${alpha(palette.overlay, 0.06)}` }}>
        <UserCard collapsed={collapsed} />
        {onToggleCollapsed && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", mt: 1, px: collapsed ? 0 : 0.5 }}>
            {!collapsed && (
              <Tooltip title={process.env.NEXT_PUBLIC_APP_COMMIT ? `Commit ${process.env.NEXT_PUBLIC_APP_COMMIT}` : ""} placement="top">
                <Typography sx={{ fontSize: "0.7rem", color: palette.textFaint }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "3.0.0"}</Typography>
              </Tooltip>
            )}
            <Tooltip title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"} placement="right">
              <IconButton size="small" onClick={onToggleCollapsed} sx={{ color: palette.textMuted }}>
                {collapsed ? <KeyboardDoubleArrowRightIcon fontSize="small" /> : <KeyboardDoubleArrowLeftIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
}
