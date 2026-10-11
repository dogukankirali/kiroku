// Manga İndirici sayfası: kaynaklarda ara → bölümleri dil önceliğine göre birleştir → seçilenleri CBZ olarak kaydet.
// Eklenti sayfasında çalıştığı için siteler istekleri bu tarayıcıdan (çerezler ve bot doğrulamasıyla) görür.

import { SOURCES, sourceById } from "./manga/sources.js";
import { LANGUAGE_MODES, mergeChapters, buildChapterCbz, chapterFileName } from "./manga/downloader.js";
import { fetchMangaMetadata, seriesJson } from "./manga/metadata.js";
import { STORAGE_KEY, DEFAULT_STORAGE, createStorage, testNas } from "./manga/storage.js";

const $ = (id) => document.getElementById(id);
const store = {
  get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
  set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
};

// ------------------------------ Ortam ------------------------------

const headerRules = new Map(); // host → { id, headers }
const env = {
  fetch: (url, init = {}) => fetch(url, { credentials: "include", ...init }),
  parseHTML: (html) => new DOMParser().parseFromString(html, "text/html"),
  /**
   * Siteye giden isteklere başlık ekler (Referer, Sec-Fetch-Site…). fetch bu başlıkları kendisi
   * ayarlayamadığı için oturumluk declarativeNetRequest kuralı kullanılır; desteklenmezse sessizce geçer.
   */
  async setHeaders(url, headers) {
    const host = new URL(url).hostname;
    const prev = headerRules.get(host);
    const merged = { ...(prev?.headers ?? {}), ...headers };
    if (prev && JSON.stringify(prev.headers) === JSON.stringify(merged)) return;
    const id = prev?.id ?? headerRules.size + 1;
    headerRules.set(host, { id, headers: merged });
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [id],
        addRules: [
          {
            id,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: Object.entries(merged).map(([header, value]) => ({ header, operation: "set", value })),
            },
            condition: { requestDomains: [host], resourceTypes: ["xmlhttprequest", "other"] },
          },
        ],
      });
    } catch (err) {
      console.warn("Başlık kuralı eklenemedi", host, err);
    }
  },
};

// ------------------------------ Günlük ------------------------------

function log(message, kind = "") {
  const line = `[${new Date().toLocaleTimeString("tr")}] ${kind === "err" ? "✖ " : kind === "ok" ? "✔ " : ""}${message}\n`;
  $("log").textContent += line;
  $("log").scrollTop = $("log").scrollHeight;
}
const setProgress = (ratio) => ($("progress").firstElementChild.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);

// ------------------------------ Kayıt yeri ------------------------------

let storageSettings = { ...DEFAULT_STORAGE };

function readStorageForm() {
  return {
    target: $("st-target").value,
    localDir: $("st-localDir").value.trim() || DEFAULT_STORAGE.localDir,
    nasUrl: $("st-nasUrl").value.trim(),
    nasKey: $("st-nasKey").value.trim(),
  };
}

function showTarget() {
  const nas = $("st-target").value === "nas";
  for (const id of ["st-nas-url-l", "st-nas-key-l", "st-test"]) $(id).style.display = nas ? "" : "none";
  $("st-local-l").style.display = nas ? "none" : "";
}

function setStatus(text, kind = "") {
  $("st-status").textContent = text;
  $("st-status").className = `md-status ${kind}`;
}

async function initStorage() {
  const data = await store.get([STORAGE_KEY, "theme", "manga_lang_mode"]);
  storageSettings = { ...DEFAULT_STORAGE, ...(data[STORAGE_KEY] ?? {}) };
  $("st-target").value = storageSettings.target;
  $("st-nasUrl").value = storageSettings.nasUrl;
  $("st-nasKey").value = storageSettings.nasKey;
  $("st-target").addEventListener("change", showTarget);
  $("st-test").addEventListener("click", async () => {
    setStatus("Deneniyor…");
    try { await testNas(readStorageForm()); setStatus("NAS'a yazılabiliyor", "ok"); } catch (e) { setStatus(e.message, "err"); }
  });
  document.body.dataset.theme = data.theme ?? "dark";
  $("st-localDir").value = storageSettings.localDir;
  showTarget();

  $("lang-mode").innerHTML = Object.entries(LANGUAGE_MODES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  $("lang-mode").value = data.manga_lang_mode ?? "tr-first";
  $("lang-mode").addEventListener("change", () => store.set({ manga_lang_mode: $("lang-mode").value }));

  $("st-save").addEventListener("click", async () => {
    storageSettings = readStorageForm();
    // Eski sürümün sunucu ayarları (WebDAV) varsa silinir; artık hiçbir sunucuya bağlanılmıyor
    await store.set({ [STORAGE_KEY]: storageSettings });
    setStatus(`Kaydedildi: ${createStorage(storageSettings).label}`, "ok");
  });
}

// ------------------------------ Arama ------------------------------

const norm = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

let results = {}; // sourceId → manga[]

function renderSourceToggles() {
  $("source-toggles").innerHTML = SOURCES.map(
    (s) => `<label><input type="checkbox" data-source="${s.id}" checked> ${s.name} <small>(${s.langs.join("/")}${s.experimental ? ", deneysel" : ""})</small></label>`
  ).join("");
}

const enabledSources = () => [...document.querySelectorAll("[data-source]")].filter((c) => c.checked).map((c) => sourceById(c.dataset.source));

/**
 * Sorguyla birebir eşleşen başlığı (alternatif adlar dahil) varsayılan seçer. Kısmi eşleşmeler
 * ("Berserk" → "Boushoku no Berserk") yanlış seriyi seçtirebileceği için kullanıcıya bırakılır.
 */
function bestMatch(query, list) {
  const q = norm(query);
  return list.findIndex((m) => [m.title, ...(m.altTitles ?? [])].map(norm).includes(q));
}

async function search() {
  const query = $("q").value.trim();
  if (!query) return;
  results = {};
  $("results").innerHTML = "";
  $("chapters-section").hidden = true;
  const sources = enabledSources();
  log(`"${query}" ${sources.length} kaynakta aranıyor…`);
  await Promise.all(
    sources.map(async (source) => {
      const row = document.createElement("div");
      row.className = "md-result";
      row.innerHTML = `<strong>${source.name}</strong><span>aranıyor…</span>`;
      $("results").append(row);
      try {
        const list = await source.search(env, query);
        results[source.id] = list;
        const best = bestMatch(query, list);
        const select = document.createElement("select");
        select.className = "mat-input";
        select.dataset.pick = source.id;
        select.innerHTML =
          `<option value="-1">— kullanma —</option>` +
          list.slice(0, 15).map((m, i) => `<option value="${i}">${escapeHtml(m.title)}</option>`).join("");
        select.value = String(best);
        row.lastElementChild.replaceWith(list.length ? select : Object.assign(document.createElement("span"), { textContent: "sonuç yok" }));
      } catch (err) {
        row.lastElementChild.replaceWith(Object.assign(document.createElement("span"), { className: "err", textContent: err.message }));
        log(`${source.name}: ${err.message}`, "err");
      }
    })
  );
  const button = Object.assign(document.createElement("button"), { className: "mat-btn btn-primary", textContent: "Bölümleri getir" });
  button.style.width = "auto";
  button.addEventListener("click", loadChapters);
  $("results").append(button);
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ------------------------------ Bölümler ------------------------------

let picked = []; // [{ source, manga }] kaynak sırasıyla
let chapters = [];
let meta = null;

async function loadChapters() {
  picked = SOURCES.map((source) => {
    const select = document.querySelector(`[data-pick="${source.id}"]`);
    const index = select ? Number(select.value) : -1;
    return index >= 0 ? { source, manga: results[source.id][index] } : null;
  }).filter(Boolean);
  if (!picked.length) return log("Hiçbir kaynakta seri seçilmedi", "err");

  const langs = LANGUAGE_MODES[$("lang-mode").value].langs;
  log(`Bölüm listeleri alınıyor (${langs.join(" → ")})…`);
  const lists = await Promise.all(
    picked.map(async ({ source, manga }) => {
      try {
        const list = await source.chapters(env, manga, langs);
        log(`${source.name}: ${list.length} bölüm`);
        return list;
      } catch (err) {
        log(`${source.name}: ${err.message}`, "err");
        return [];
      }
    })
  );
  chapters = mergeChapters(lists, langs);

  // Seri bilgisi: MangaDex eşleşmesi AniList/MAL kimliği verirse onu, yoksa başlıkla ara
  const md = picked.find((p) => p.source.id === "mangadex")?.manga.data ?? {};
  meta = await fetchMangaMetadata(env, { anilistId: md.anilistId, malId: md.malId, search: $("q").value.trim() }).catch(() => null);
  $("meta-info").value = meta ? `${meta.romaji}${meta.malId ? ` · MAL ${meta.malId}` : ""} · AniList ${meta.anilistId}` : "Bulunamadı";
  $("series-name").value = meta?.romaji || picked[0].manga.title;

  renderChapters();
  const nums = chapters.map((c) => c.number).filter((n) => n != null);
  $("from").value = nums.length ? Math.min(...nums) : "";
  $("to").value = nums.length ? Math.max(...nums) : "";
  $("chapters-section").hidden = false;
}

function renderChapters() {
  const seriesName = $("series-name").value.trim();
  const counts = chapters.reduce((acc, c) => ((acc[c.lang] = (acc[c.lang] ?? 0) + 1), acc), {});
  $("chapter-summary").textContent = `${chapters.length} bölüm · ${Object.entries(counts).map(([l, n]) => `${l.toUpperCase()} ${n}`).join(", ")}`;
  $("chapter-rows").innerHTML = chapters
    .map(
      (c, i) => `<tr data-row="${i}">
        <td><input type="checkbox" data-ch="${i}"></td>
        <td>${c.number ?? "—"}</td>
        <td>${escapeHtml(c.title)}</td>
        <td>${escapeHtml(sourceById(c.source).name)}${c.group && c.group !== sourceById(c.source).name ? ` <small>(${escapeHtml(c.group)})</small>` : ""}</td>
        <td>${c.lang.toUpperCase()}</td>
        <td><small>${escapeHtml(chapterFileName(c, seriesName))}</small></td>
      </tr>`
    )
    .join("");
}

const checkboxes = () => [...document.querySelectorAll("[data-ch]")];

function selectRange() {
  const from = Number($("from").value);
  const to = Number($("to").value);
  checkboxes().forEach((cb) => {
    const n = chapters[cb.dataset.ch].number;
    cb.checked = n != null && n >= from && n <= to;
  });
}

// ------------------------------ İndirme ------------------------------

let stopRequested = false;

async function downloadSelected() {
  const selected = checkboxes().filter((cb) => cb.checked).map((cb) => Number(cb.dataset.ch));
  if (!selected.length) return log("Bölüm seçilmedi", "err");
  const seriesName = $("series-name").value.trim() || picked[0].manga.title;

  const target = createStorage(readStorageForm());
  log(`${selected.length} bölüm indirilecek → ${target.label}/${seriesName}`);
  stopRequested = false;
  $("download").disabled = true;
  $("stop").disabled = false;

  try {
    await target.write(seriesName, "series.json", new TextEncoder().encode(seriesJson(seriesName, meta)), "application/json");
    if (meta?.cover) {
      const cover = await env.fetch(meta.cover, { credentials: "omit" }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      if (cover) await target.write(seriesName, "cover.jpg", new Uint8Array(cover), "image/jpeg");
    }
  } catch (err) {
    log(`Seri bilgileri yazılamadı: ${err.message}`, "err");
  }

  let ok = 0;
  for (const [n, index] of selected.entries()) {
    if (stopRequested) {
      log("Durduruldu");
      break;
    }
    const chapter = chapters[index];
    const row = document.querySelector(`[data-row="${index}"]`);
    try {
      const cbz = await buildChapterCbz(env, chapter, {
        seriesName,
        meta,
        onPage: (done, total) => setProgress((n + done / total) / selected.length),
      });
      await target.write(seriesName, cbz.fileName, cbz.bytes, "application/vnd.comicbook+zip");
      row?.classList.add("done");
      const cb = row?.querySelector("input");
      if (cb) cb.checked = false;
      ok++;
      log(`${cbz.fileName} (${cbz.pageCount} sayfa, ${(cbz.bytes.length / 1048576).toFixed(1)} MB)`, "ok");
    } catch (err) {
      row?.classList.add("failed");
      log(`Bölüm ${chapter.number ?? chapter.title}: ${err.message}`, "err");
    }
    setProgress((n + 1) / selected.length);
  }
  log(`Bitti: ${ok}/${selected.length} bölüm kaydedildi`);
  $("download").disabled = false;
  $("stop").disabled = true;
}

// ------------------------------ Başlat ------------------------------

renderSourceToggles();
initStorage();
$("search").addEventListener("click", search);
$("q").addEventListener("keydown", (e) => e.key === "Enter" && search());
$("select-range").addEventListener("click", selectRange);
$("select-all").addEventListener("click", () => checkboxes().forEach((cb) => (cb.checked = true)));
$("select-none").addEventListener("click", () => checkboxes().forEach((cb) => (cb.checked = false)));
$("series-name").addEventListener("input", renderChapters);
$("download").addEventListener("click", downloadSelected);
$("stop").addEventListener("click", () => {
  stopRequested = true;
  $("stop").disabled = true;
});
