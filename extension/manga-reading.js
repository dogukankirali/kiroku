// ============================================================
// Dijital manga okuma takibi: listedeki okuma sitelerinde (varsayılan ravenscans, mangadex, mgeko, MANGA Plus;
// eklentinin Ayarlar sekmesinden site eklenebilir) açık bölümü algılar ve son okunan bölümü Kiroku'ya yazar.
// Bölüm sayfanın sonuna kadar okununca (ya da "Kaydet" ile) kaydedilir. Site adındaki seri Kiroku'daki
// mangayla eşleşmezse kullanıcı bir kez seçer; seçim bu site + seri için hatırlanır.
// ============================================================
(() => {
    if (window.top !== window) return;

    const DEFAULT_SITES = ["ravenscans.org", "ravenscans.com", "mangadex.org", "mgeko.cc", "mangaplus.shueisha.co.jp"];
    const host = location.hostname.replace(/^www\./, "");
    let panel = null;
    let current = null; // { key, title, chapter, url }
    let savedFor = "";
    let lastHref = "";

    chrome.storage.local.get(["manga_sites", "extension_enabled"], (s) => {
        const sites = Array.isArray(s.manga_sites) && s.manga_sites.length ? s.manga_sites : DEFAULT_SITES;
        if (s.extension_enabled === false) return;
        if (!sites.some((d) => host === d || host.endsWith("." + d))) return;
        // Tek sayfalık siteler (MangaDex, MANGA Plus) adresi yenilemeden değiştirir
        setInterval(() => {
            if (location.href !== lastHref) {
                lastHref = location.href;
                setTimeout(detect, 1500);
            }
        }, 1000);
        window.addEventListener("scroll", onScroll, { passive: true });
    });

    const CHAPTER_RE = /(?:chapter|chap|ch\.?|bölüm|bolum)\s*[-_#:]?\s*(\d+(?:[.,]\d+)?)/i;
    const URL_CHAPTER_RE = /(?:chapter|chap|ch|bolum|bölüm)[-_/.]?(\d+(?:[-_.]\d+)?)/i;

    function chapterNumber() {
        const fromTitle = CHAPTER_RE.exec(document.title);
        if (fromTitle) return Number(fromTitle[1].replace(",", "."));
        const fromUrl = URL_CHAPTER_RE.exec(decodeURIComponent(location.pathname));
        if (fromUrl) return Number(fromUrl[1].replace(/[-_]/, "."));
        const heading = document.querySelector("h1, h2");
        const fromHeading = heading && CHAPTER_RE.exec(heading.textContent || "");
        return fromHeading ? Number(fromHeading[1].replace(",", ".")) : 0;
    }

    // Başlıktaki "Seri - Bölüm 12 - Site" gibi parçalardan seriyi ayıklar
    function seriesTitle() {
        const brand = host.split(".")[0].toLowerCase();
        const parts = document.title
            .split(/\s+[|–—-]\s+|\s+:\s+/)
            .map((p) => p.replace(CHAPTER_RE, "").replace(/\b(read|online|free|manga|manhwa|manhua|scans?|english|raw)\b/gi, " ").replace(/\s+/g, " ").trim())
            .filter((p) => p.length > 1 && !p.toLowerCase().replace(/\s/g, "").includes(brand) && !/^by\s/i.test(p));
        if (parts[0]) return parts[0];
        const heading = document.querySelector("h1, h2");
        return heading ? (heading.textContent || "").replace(CHAPTER_RE, "").trim() : "";
    }

    function seriesKey(title) {
        // Adresin ilk anlamlı parçası (ör. /manga/solo-leveling/...) seri için daha kararlı bir anahtar
        const seg = location.pathname.split("/").filter(Boolean).find((p) => p.length > 3 && !/^(manga|series|comic|read|reader|en|viewer|chapter|title)$/i.test(p) && !/^[0-9a-f-]{20,}$/i.test(p));
        const slug = seg ? seg.replace(URL_CHAPTER_RE, "").replace(/[-_]+$/, "") : "";
        return `${host}|${(slug || title).toLowerCase()}`;
    }

    function detect() {
        const chapter = chapterNumber();
        if (!chapter) {
            current = null;
            if (panel) panel.style.display = "none";
            return;
        }
        const title = seriesTitle();
        current = { key: seriesKey(title), title, chapter, url: location.href };
        render(`${title || "Seri algılanamadı"} · Bölüm ${chapter}`, "Sayfanın sonuna gelince Kiroku'ya kaydedilir.");
    }

    function onScroll() {
        if (!current || savedFor === current.url) return;
        const doc = document.documentElement;
        const ratio = (window.scrollY + window.innerHeight) / Math.max(doc.scrollHeight, 1);
        if (ratio >= 0.85) save();
    }

    function save(mangaIdOverride) {
        if (!current) return;
        chrome.storage.local.get(["manga_map"], (s) => {
            const map = s.manga_map || {};
            const mapped = mangaIdOverride || (map[current.key] && map[current.key].id);
            savedFor = current.url;
            chrome.runtime.sendMessage(
                { action: "saveMangaProgress", data: { mangaId: mapped || undefined, title: current.title, chapter: current.chapter, url: current.url } },
                (res) => {
                    if (chrome.runtime.lastError || !res) {
                        savedFor = "";
                        return render(null, "Eklentiye ulaşılamadı, sayfayı yenile.", true);
                    }
                    if (res.success) {
                        const name = res.data && res.data.name ? res.data.name : current.title;
                        if (mangaIdOverride) {
                            map[current.key] = { id: mangaIdOverride, name };
                            chrome.storage.local.set({ manga_map: map });
                        }
                        return render(`${name} · Bölüm ${current.chapter}`, "✓ Kiroku'ya kaydedildi", false, true);
                    }
                    savedFor = "";
                    if (res.notFound) return showPicker(res.candidates || []);
                    render(null, res.error || "Kaydedilemedi", true);
                }
            );
        });
    }

    function showPicker(candidates) {
        render(null, "Kiroku'da bu seriyi seç (bir kez seçmen yeter):", true);
        const list = panel.querySelector(".kk-list");
        list.innerHTML = "";
        const addItem = (m) => {
            const b = document.createElement("button");
            b.textContent = m.name + (m.englishName && m.englishName !== m.name ? ` (${m.englishName})` : "");
            b.onclick = () => save(m.id);
            list.appendChild(b);
        };
        candidates.forEach(addItem);
        const input = document.createElement("input");
        input.placeholder = "Kiroku'da ara…";
        input.onkeydown = (e) => {
            if (e.key !== "Enter") return;
            chrome.runtime.sendMessage({ action: "searchKirokuManga", q: input.value }, (res) => {
                list.querySelectorAll("button").forEach((b) => b.remove());
                const found = (res && res.success && res.data && res.data.data) || [];
                found.forEach(addItem);
                if (!found.length) render(null, "Sonuç yok. Önce Kiroku'da mangayı ekle.", true);
                list.appendChild(input);
                input.focus();
            });
        };
        list.appendChild(input);
    }

    function render(head, status, isWarn = false, done = false) {
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "kiroku-manga-panel";
            panel.innerHTML = `
                <div class="kk-row"><b>📖 Kiroku</b><span class="kk-head"></span><button class="kk-x" title="Kapat">×</button></div>
                <div class="kk-status"></div>
                <div class="kk-list"></div>
                <div class="kk-actions"><button class="kk-save">Şimdi kaydet</button></div>`;
            Object.assign(panel.style, {
                position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483646, width: "280px", padding: "10px 12px",
                borderRadius: "12px", background: "#12161E", color: "#E7E9EE", border: "1px solid #232938",
                font: "12px/1.4 system-ui, sans-serif", boxShadow: "0 10px 30px rgba(0,0,0,.4)",
            });
            const style = document.createElement("style");
            style.textContent = `#kiroku-manga-panel button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid #2d3445;background:#181D27;color:#E7E9EE;padding:4px 8px;margin:4px 4px 0 0}
                #kiroku-manga-panel .kk-row{display:flex;gap:6px;align-items:center}#kiroku-manga-panel .kk-head{flex:1;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                #kiroku-manga-panel .kk-x{border:0;background:none;padding:0 4px;font-size:16px;margin:0}#kiroku-manga-panel .kk-status{margin-top:4px;opacity:.8}
                #kiroku-manga-panel .kk-list{display:flex;flex-direction:column;max-height:180px;overflow:auto}#kiroku-manga-panel .kk-list button{text-align:left}
                #kiroku-manga-panel input{margin-top:6px;padding:5px 8px;border-radius:8px;border:1px solid #2d3445;background:#0B0D12;color:#E7E9EE}
                #kiroku-manga-panel .kk-save{background:#7C5CFF;border-color:#7C5CFF;color:#fff}`;
            document.head.appendChild(style);
            document.body.appendChild(panel);
            panel.querySelector(".kk-x").onclick = () => (panel.style.display = "none");
            panel.querySelector(".kk-save").onclick = () => save();
        }
        panel.style.display = "block";
        if (head !== null) panel.querySelector(".kk-head").textContent = head;
        const st = panel.querySelector(".kk-status");
        st.textContent = status;
        st.style.color = isWarn ? "#F59E0B" : done ? "#22C55E" : "";
        if (!isWarn) panel.querySelector(".kk-list").innerHTML = "";
    }
})();
