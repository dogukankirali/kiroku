// CBZ'ler doğrudan bu bilgisayara, tarayıcının İndirilenler klasörü altına (varsayılan Kiroku/Manga/<Seri>/)
// yazılır. Arada hiçbir sunucuya gönderilmez ve hiçbir yerde kopyası tutulmaz; dosyaları sunucuya
// kullanıcı kendisi taşır.

export const STORAGE_KEY = "manga_storage";

export const DEFAULT_STORAGE = {
  target: "local", // "local" | "nas"
  localDir: "Kiroku/Manga", // İndirilenler altındaki klasör
  nasUrl: "", // yazılabilir kütüphane sunucusu (scripts/manga-library.mjs --writable)
  nasKey: "",
};

/** Sunucuya PUT ile yükler: <nasUrl>/<Seri>/<dosya>?key= */
export function nasFileUrl(settings, seriesDir, fileName) {
  const base = String(settings.nasUrl || "").replace(/\/+$/, "");
  const key = settings.nasKey ? `?key=${encodeURIComponent(settings.nasKey)}` : "";
  return `${base}/${encodeURIComponent(safeName(seriesDir))}/${encodeURIComponent(safeName(fileName))}${key}`;
}

/** Sunucuya erişilebiliyor ve yazma açık mı? Küçük bir deneme dosyası yükleyip siler. */
export async function testNas(settings) {
  const base = String(settings.nasUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Sunucu adresi boş");
  const url = nasFileUrl(settings, ".kiroku-test", "test.txt");
  const res = await fetch(url, { method: "PUT", body: "ok" });
  if (!res.ok) throw new Error(res.status === 405 ? "Sunucu salt okunur (--writable ile başlat)" : res.status === 401 || res.status === 403 ? "Anahtar reddedildi" : `Sunucu ${res.status} döndü`);
  return true;
}

/** Dosya/klasör adında işletim sistemlerinin kabul etmediği karakterleri temizler */
export function safeName(name) {
  return (
    String(name ?? "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "")
      .slice(0, 150) || "isimsiz"
  );
}

export function createStorage(settings) {
  if (settings.target === "nas") {
    return {
      label: `NAS (${settings.nasUrl})`,
      async write(seriesDir, fileName, bytes, type = "application/octet-stream") {
        const res = await fetch(nasFileUrl(settings, seriesDir, fileName), { method: "PUT", headers: { "Content-Type": type }, body: new Blob([bytes], { type }) });
        if (!res.ok) throw new Error(`NAS yükleme hatası: ${res.status}`);
      },
    };
  }
  const root = (settings.localDir || DEFAULT_STORAGE.localDir).split("/").filter(Boolean).map(safeName).join("/");
  return {
    label: `İndirilenler/${root}`,
    async write(seriesDir, fileName, bytes, type = "application/octet-stream") {
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      try {
        await new Promise((resolve, reject) => {
          chrome.downloads.download(
            { url, filename: `${root}/${safeName(seriesDir)}/${safeName(fileName)}`, conflictAction: "overwrite", saveAs: false },
            (id) => (chrome.runtime.lastError || id === undefined ? reject(new Error(chrome.runtime.lastError?.message ?? "İndirme başlatılamadı")) : resolve(id))
          );
        });
      } finally {
        // Blob yalnızca bellekte; indirme başlayınca bırakılır (hemen bırakılırsa Firefox yarıda kesebiliyor)
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    },
  };
}
