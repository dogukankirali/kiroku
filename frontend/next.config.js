/** @type {import('next').NextConfig} */

const { execSync } = require("child_process");

// Sol alttaki sürüm: her commit'te artan "v3.0.<commit sayısı>". Derleme ortamı repoyu sığ (shallow)
// klonladıysa commit sayısı anlamsız olur; o zaman tarih kullanılır. Commit kısaltması ipucunda gösterilir.
function appVersion() {
  const git = (cmd) => {
    try {
      return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const shallow = git("rev-parse --is-shallow-repository") === "true";
  const count = Number(git("rev-list --count HEAD")) || 0;
  const sha = (process.env.WORKERS_CI_COMMIT_SHA || git("rev-parse --short HEAD")).slice(0, 7);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return { version: !shallow && count > 1 ? `3.0.${count}` : `3.0.0-${date}`, commit: sha };
}
const { version: APP_VERSION, commit: APP_COMMIT } = appVersion();

// `npm run build:cf`: Cloudflare Worker'ın sunacağı statik çıktı (out/). API aynı origin'de /api altında.
// `npm run build`: `next start` ile çalışan Node çıktısı.
const staticExport = process.env.npm_lifecycle_event === "build:cf" || process.env.NEXT_OUTPUT === "export";
// `next dev` sırasında /api istekleri lokal Worker'a (wrangler dev) yönlendirilir
const devApi = process.env.KIROKU_API_ORIGIN || "http://127.0.0.1:8787";

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
    NEXT_PUBLIC_APP_COMMIT: APP_COMMIT,
  },
  poweredByHeader: false,
  ...(staticExport ? { output: "export" } : {}),
  // ESLint kurulu değil (eslint-config-next zinciri yaması olmayan bir açık taşıyor); tip kontrolü build'de açık
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // MUI ikon/bileşen importlarını yalnızca kullanılan modüllere indirger
    optimizePackageImports: ["@mui/material", "@mui/icons-material", "lodash"],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  images: {
    // Kapaklar MAL CDN'inden ve /api/anime-cover adresinden geliyor
    unoptimized: true,
  },
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    return config;
  },
  ...(staticExport
    ? {}
    : {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${devApi}/api/:path*` }];
        },
      }),
};

module.exports = nextConfig;
