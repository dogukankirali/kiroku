// ============================================================
// AniTracker Pro + AniSyncer Unified Content Script
// ============================================================

// ============================================================
// PART 1: AniTracker Core (Overlay & Skip Counter)
// ============================================================

let isTrackingActive = false;
let indicator = null;
let currentSkips = 0;
let currentMode = 'detailed';
let currentAnime = null;
let hideTimeout = null;
let lastUrl = location.href;
const isTopFrame = window === window.top;
let extensionEnabled = true;

chrome.storage.local.get(['trackingActive', 'totalSkips', 'overlayMode', 'anime', 'extension_enabled'], (data) => {
    isTrackingActive = data.trackingActive || false;
    currentSkips = data.totalSkips || 0;
    currentMode = data.overlayMode || 'detailed';
    currentAnime = data.anime || null;
    extensionEnabled = data.extension_enabled !== false;
    
    if (isTrackingActive) updateIndicator();
    if (isTopFrame) initSyncerButtons();
});

chrome.storage.onChanged.addListener((changes) => {
    let needsUpdate = false;
    if (changes.trackingActive) { isTrackingActive = changes.trackingActive.newValue; needsUpdate = true; }
    if (changes.totalSkips) { currentSkips = changes.totalSkips.newValue; needsUpdate = true; }
    if (changes.overlayMode) { currentMode = changes.overlayMode.newValue; needsUpdate = true; }
    if (changes.anime) { currentAnime = changes.anime.newValue; needsUpdate = true; }
    if (changes.extension_enabled) {
        extensionEnabled = changes.extension_enabled.newValue !== false;
        if (!extensionEnabled) {
            removeSyncerButtons();
        } else if (isTopFrame) {
            initSyncerButtons();
        }
    }
    if (needsUpdate) updateIndicator();
});

// URL Değişim Kontrolü
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (isTrackingActive) {
            chrome.runtime.sendMessage({ action: 'url_changed', url: lastUrl });
        }
        if (isTopFrame && extensionEnabled) {
            setTimeout(initSyncerButtons, 600);
        }
    }
}, 1000);

function createIndicator() {
    if (document.getElementById('anitracker-indicator')) return document.getElementById('anitracker-indicator');
    
    indicator = document.createElement('div');
    indicator.id = 'anitracker-indicator';
    
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes at-pulse { 0% { opacity: 1; } 50% { opacity: 0.2; } 100% { opacity: 1; } }
        .at-rec-dot { animation: at-pulse 1.5s infinite; font-size: 10px; margin-right: 4px; color: #ef4444; }
        
        #anitracker-indicator {
            position: fixed; top: 20px; right: 20px; background: rgba(18, 18, 18, 0.9); color: #fff;
            padding: 8px 12px; border-radius: 8px; font-family: "Roboto", -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px; font-weight: 500; z-index: 2147483647; display: none; flex-direction: column;
            border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(8px); 
            transition: max-height 0.3s ease, margin 0.3s ease, opacity 0.5s ease, border-color 0.15s ease;
            overflow: hidden; box-sizing: border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            opacity: 1;
        }
        
        #anitracker-indicator.detailed { pointer-events: auto; }
        #anitracker-indicator.minimal { pointer-events: none; }
        
        .at-header { display: flex; align-items: center; white-space: nowrap; transition: color 0.15s ease; cursor: default; }
        .at-details { display: flex; gap: 10px; max-height: 0; opacity: 0; margin-top: 0; transition: all 0.3s ease; }
        
        #anitracker-indicator.detailed:hover .at-details { max-height: 120px; opacity: 1; margin-top: 10px; }
        
        .at-details img { width: 50px; height: 75px; object-fit: cover; border-radius: 4px; }
        .at-info { display: flex; flex-direction: column; justify-content: center; max-width: 160px; }
        .at-info strong { font-size: 13px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; margin-bottom: 2px; }
        .at-info small { font-size: 11px; color: #7C5CFF; margin-bottom: 6px; }
        .at-info span { font-size: 12px; color: #aaa; font-weight: 400; }
        .at-info span b { color: #ef4444; font-weight: 600; font-size: 14px; }
    `;
    document.head.appendChild(style);

    indicator.innerHTML = `
        <div class="at-header">
            <span class="at-rec-dot">🔴</span> 
            <span>Kiroku: <span id="at-skip-count">0</span></span>
        </div>
        <div class="at-details">
            <img id="at-anime-cover" src="" alt="anime cover" />
            <div class="at-info">
                <strong id="at-anime-title">Anime Seçilmedi</strong>
                <small id="at-anime-season">1. Sezon</small>
                <span>Toplam Skip: <b id="at-skip-count-detail">0</b></span>
            </div>
        </div>
    `;
    
    return indicator;
}

function wakeUpIndicator() {
    if (!indicator || !isTrackingActive) return;
    indicator.style.opacity = '1';
    indicator.style.pointerEvents = currentMode === 'detailed' ? 'auto' : 'none';
    clearTimeout(hideTimeout);
    
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
        hideTimeout = setTimeout(() => {
            if (indicator) {
                indicator.style.opacity = '0';
                indicator.style.pointerEvents = 'none';
            }
        }, 3000);
    }
}

document.addEventListener('mousemove', wakeUpIndicator);

function updateIndicator() {
    if (!isTrackingActive) {
        if (indicator) indicator.style.display = 'none';
        return;
    }
    
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const shouldShow = isTopFrame || fsEl;
    
    if (shouldShow) {
        if (!indicator) indicator = createIndicator();
        
        indicator.className = currentMode;
        indicator.querySelector('#at-skip-count').innerText = currentSkips;
        indicator.querySelector('#at-skip-count-detail').innerText = currentSkips;
        
        if (currentAnime) {
            indicator.querySelector('#at-anime-cover').src = currentAnime.image || '';
            indicator.querySelector('#at-anime-title').innerText = currentAnime.title || 'Bilinmiyor';
            indicator.querySelector('#at-anime-season').innerText = (currentAnime.season || 1) + '. Sezon';
            indicator.querySelector('.at-details').style.display = 'flex';
        } else {
            indicator.querySelector('.at-details').style.display = 'none';
        }
        
        indicator.style.display = 'flex';
        wakeUpIndicator();
        
        if (fsEl) {
            if (fsEl.tagName.toLowerCase() === 'video') {
                if (fsEl.parentNode) fsEl.parentNode.appendChild(indicator);
            } else {
                fsEl.appendChild(indicator);
            }
        } else {
            if (document.body) document.body.appendChild(indicator);
        }
    } else {
        if (indicator) indicator.style.display = 'none';
    }
}

document.addEventListener('fullscreenchange', updateIndicator);
document.addEventListener('webkitfullscreenchange', updateIndicator);

function isVideoPlaying() {
    let isPlaying = false;
    const checkRoot = (root) => {
        const videos = root.querySelectorAll('video');
        for (let v of videos) {
            if (!v.paused && !v.ended) { isPlaying = true; return; }
        }
        const allElements = root.querySelectorAll('*');
        for (let el of allElements) {
            if (el.shadowRoot) checkRoot(el.shadowRoot);
            if (isPlaying) return;
        }
    };
    checkRoot(document);
    return isPlaying;
}

function flashIndicator() {
    if (indicator && indicator.style.display !== 'none') {
        indicator.style.borderColor = 'rgba(239, 68, 68, 0.9)';
        wakeUpIndicator();
        setTimeout(() => { indicator.style.borderColor = 'rgba(255,255,255,0.1)'; }, 150);
    }
}

window.addEventListener('keydown', (e) => {
    if (!isTrackingActive) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (e.key === 'ArrowRight') {
        const hostname = window.location.hostname.toLowerCase();
        const blacklist = ['youtube.', 'youtu.be', 'twitch.tv', 'netflix.', 'primevideo.', 'disneyplus.', 'exxen.', 'blutv.'];
        const isBlacklisted = blacklist.some(domain => hostname.includes(domain));
        
        let titleMatch = false;
        if (currentAnime && currentAnime.title) {
            const firstWord = currentAnime.title.toLowerCase().split(' ')[0];
            if (firstWord.length > 2 && document.title.toLowerCase().includes(firstWord)) titleMatch = true;
        }
        
        if (isBlacklisted && !titleMatch) return;

        if (isVideoPlaying()) {
            chrome.runtime.sendMessage({ action: 'skip_pressed', url: location.href });
            flashIndicator();
            chrome.runtime.sendMessage({ action: 'relay_blink' });
        }
    }
});


// ============================================================
// PART 2: AniSyncer Site Butonları (MAL + Anizium + TrAnimeİzle + TürkAnime)
// ============================================================

function extractEpisodeNumber(url) {
    try {
        const u = new URL(url);
        const epParam = u.searchParams.get("episode") || u.searchParams.get("ep");
        if (epParam && !isNaN(parseInt(epParam))) return parseInt(epParam);
    } catch(e) {}

    const epPattern = /episode[-_](\d+)/i;
    const epMatch = url.match(epPattern);
    if (epMatch) return parseInt(epMatch[1]);

    const bolumPattern = /([0-9]+)[._-]bolum/i;
    const bMatch = url.match(bolumPattern);
    if (bMatch) return parseInt(bMatch[1]);

    return 0;
}

function cleanAnimeTitle(raw) {
    if (!raw) return "";
    let str = raw;
    // Remove typical streaming site tags / noise words
    str = str.replace(/\b(İzle|izle|Türkçe|Dublaj|Altyazı|Altyazılı|Full HD|4K|1080p|720p|Anizium|TrAnimeİzle|Türkanime|Turkanime|Anime|Watch)\b/gi, " ");
    // Remove season / episode patterns
    str = str.replace(/\b\d+\.\s*(Sezon|Bölüm|Season|Episode)\b/gi, " ");
    str = str.replace(/\b(Sezon|Bölüm|Season|Episode)\s*\d+\b/gi, " ");
    // Remove short codes like S1, B1, E12
    str = str.replace(/\b[SBEsbe]\d+\b/g, " ");
    // Remove separators
    str = str.replace(/[|\-_–—:[\]()]/g, " ");
    // Normalize spaces
    str = str.replace(/\s+/g, " ").trim();
    return str;
}

function cleanTitle(title) {
    return cleanAnimeTitle(title);
}

function extractStreamingDetailTitle() {
    const selectors = [
        ".anime-details h1",
        ".anime-info h1",
        ".anime-title",
        ".film-title",
        ".film-name",
        ".playlist-title h1",
        "h1"
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
            const cleaned = cleanAnimeTitle(el.textContent.trim());
            if (cleaned) return cleaned;
        }
    }
    return cleanAnimeTitle(document.title);
}

function getMALAnimeData() {
    const nameEl = document.querySelector(".title-name.h1_bold_none strong") || document.querySelector("h1");
    if (!nameEl) return null;

    const statusEl = Array.from(document.querySelectorAll(".spaceit_pad")).find(el => el.textContent.includes("Status:"));
    const episodesEl = Array.from(document.querySelectorAll(".spaceit_pad")).find(el => el.textContent.includes("Episodes:"));
    const typeEl = Array.from(document.querySelectorAll(".spaceit_pad")).find(el => el.textContent.includes("Type:"));
    const coverEl = document.querySelector(".leftside img, img[itemprop='image']");

    return {
        Name: nameEl.textContent.trim(),
        AnimeStatus: statusEl ? statusEl.textContent.replace("Status:", "").trim() : "Finished Airing",
        WatchStatus: 0,
        TotalNumberOfEpisodes: episodesEl ? parseInt(episodesEl.textContent.replace("Episodes:", "").trim()) || 0 : 0,
        IsMovie: typeEl ? typeEl.textContent.replace("Type:", "").trim().toLowerCase() === "movie" : false,
        Score: -1,
        MALScore: 0,
        Notes: "",
        Genre: "",
        MALAnimeLink: window.location.href,
        Cover: coverEl ? coverEl.src : "",
        AnimeLink: "",
        Series: 0,
        PlanToWatch: true
    };
}

function getAniziumDetailData() {
    const title = extractStreamingDetailTitle();
    
    // Total episodes parsing from text like "You have watched 50 out of a total of 51 episodes!"
    let totalEps = 0;
    const pageText = document.body.innerText || "";
    const epMatch = pageText.match(/out of a total of (\d+) episodes/i) || pageText.match(/(\d+)\s*bölüm/i);
    if (epMatch) totalEps = parseInt(epMatch[1]);

    const coverEl = document.querySelector(".anime-poster img, .poster img, img.img-fluid, img[src*='poster'], .film-poster img");

    return {
        Name: title,
        AnimeStatus: "Currently Airing",
        WatchStatus: 0,
        TotalNumberOfEpisodes: totalEps,
        IsMovie: false,
        Score: -1,
        MALScore: 0,
        Notes: "",
        Genre: "",
        MALAnimeLink: "",
        Cover: coverEl ? coverEl.src : "",
        AnimeLink: window.location.href,
        Series: 0,
        PlanToWatch: true
    };
}

function getStreamingEpisodeData() {
    const url = window.location.href;
    const episode = extractEpisodeNumber(url);

    let title = "";
    if (url.includes("tranimeizle.top")) {
        const titleEl = document.querySelector(".playlist-title h1") || document.querySelector("h1");
        if (titleEl) title = cleanAnimeTitle(titleEl.textContent);
    } else {
        const h1 = document.querySelector("h1, .anime-title, .watch-title");
        if (h1 && h1.textContent.trim()) {
            title = cleanAnimeTitle(h1.textContent);
        } else {
            title = extractStreamingDetailTitle();
        }
    }

    return {
        name: title,
        currentEpisode: episode
    };
}

// ------------------------------------------------------------
// 1. MAL Sayfası Entegrasyonu (Görsel 2'deki gibi)
// ------------------------------------------------------------
function addMALWatchlistButton() {
    const url = window.location.href;
    if (!url.includes("myanimelist.net/anime/")) return;
    if (document.querySelector(".add-to-anisync-mal-btn")) return;

    // Hedef yer: "Add to My List" / "Add to Favorites" linklerinin hemen altı (Görsel 2)
    const allLinks = Array.from(document.querySelectorAll("a, span, div"));
    const addToListLink = allLinks.find(el => el.textContent.trim().toLowerCase() === "add to my list") ||
                          allLinks.find(el => el.textContent.trim().toLowerCase() === "add to favorites");

    let container = null;
    let refNode = null;

    if (addToListLink && addToListLink.parentElement) {
        container = addToListLink.parentElement;
        refNode = addToListLink.nextSibling;
    } else {
        container = document.querySelector(".user-status-block") || 
                    document.querySelector(".js-sns-icon-container") || 
                    document.querySelector(".leftside");
    }

    if (!container) return;

    const anisyncBtn = document.createElement("a");
    anisyncBtn.href = "#";
    anisyncBtn.className = "add-to-anisync-mal-btn";
    anisyncBtn.textContent = "Add to Kiroku Watchlist";
    anisyncBtn.style.cssText = `
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: #4f74c8;
        text-decoration: underline;
        margin: 6px 0 8px 0;
        cursor: pointer;
        transition: color 0.2s ease;
    `;

    anisyncBtn.addEventListener("mouseover", () => anisyncBtn.style.color = "#3c5aa6");
    anisyncBtn.addEventListener("mouseout", () => {
        if (!anisyncBtn.dataset.done) anisyncBtn.style.color = "#4f74c8";
    });

    anisyncBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const data = getMALAnimeData();
        if (!data || !data.Name) {
            anisyncBtn.textContent = "Anime bilgileri okunamadı!";
            anisyncBtn.style.color = "#ef4444";
            return;
        }

        anisyncBtn.textContent = "Adding to Kiroku...";
        anisyncBtn.style.color = "#9B82FF";

        chrome.runtime.sendMessage({ action: "addToWatchlist", data }, (response) => {
            if (response && response.success) {
                anisyncBtn.textContent = "Added to Kiroku Watchlist ✓";
                anisyncBtn.style.color = "#10b981";
                anisyncBtn.style.textDecoration = "none";
                anisyncBtn.dataset.done = "true";
            } else {
                const isDup = response?.error?.toLowerCase().includes("duplicate") || response?.error?.toLowerCase().includes("zaten");
                const msg = isDup ? "Already in Watchlist" : "Error!";
                anisyncBtn.textContent = msg;
                anisyncBtn.style.color = isDup ? "#f59e0b" : "#ef4444";
            }
        });
    });

    // MAL'ın kendi "Add to Favorites" satırının kopyası gibi görünsün: aynı sınıf, aynı sarmalayıcı, satır ardına
    const favEl = Array.from(document.querySelectorAll(".leftside a, .leftside span, .leftside div, .leftside li"))
        .filter(el => el.textContent.trim().toLowerCase() === "add to favorites")
        .pop();
    if (favEl) {
        anisyncBtn.className = `${favEl.className || ""} add-to-anisync-mal-btn`.trim();
        anisyncBtn.removeAttribute("style");
        anisyncBtn.style.cursor = "pointer";
        const computed = getComputedStyle(favEl);
        anisyncBtn.style.color = computed.color;
        anisyncBtn.style.font = computed.font;
        let row = favEl;
        while (row.parentElement && row.parentElement.children.length === 1 && !row.parentElement.classList.contains("leftside")) row = row.parentElement;
        let holder = anisyncBtn;
        for (let el = favEl; el !== row; ) {
            el = el.parentElement;
            const wrap = el.cloneNode(false);
            wrap.removeAttribute("id");
            wrap.appendChild(holder);
            holder = wrap;
        }
        const defaultColor = computed.color;
        anisyncBtn.onmouseover = null;
        anisyncBtn.addEventListener("mouseout", () => { if (!anisyncBtn.dataset.done) anisyncBtn.style.color = defaultColor; });
        row.parentElement.insertBefore(holder, row.nextSibling);
        return;
    }

    if (refNode) {
        container.insertBefore(anisyncBtn, refNode);
    } else {
        container.appendChild(anisyncBtn);
    }
}

// ------------------------------------------------------------
// 2. Anizium (veya TrAnimeİzle) Anime Detay Sayfası (Görsel 3)
// ------------------------------------------------------------
function addAniziumDetailWatchlistButton() {
    const url = window.location.href;
    const isDetail = (url.includes("anizium.co/anime/") || url.includes("anizium.com/anime/") || url.includes("tranimeizle.top/anime/")) && !url.includes("/watch");
    if (!isDetail) return;
    if (document.querySelector(".add-to-anisync-detail-btn")) return;

    // Görsel 3'teki buton satırını bul: "Add to My List", "Unfollow", "Remove from Favorites"
    const buttons = Array.from(document.querySelectorAll("button, a, .btn"));
    const refBtn = buttons.find(b => {
        const txt = b.textContent.trim().toLowerCase();
        return txt.includes("add to my list") || 
               txt.includes("unfollow") || 
               txt.includes("follow") || 
               txt.includes("remove from favorites") || 
               txt.includes("add to favorites") ||
               txt.includes("listeme ekle");
    });

    if (!refBtn || !refBtn.parentElement) return;

    const btn = document.createElement("button");
    btn.className = "btn add-to-anisync-detail-btn";
    btn.textContent = "Add to Kiroku Watchlist";
    btn.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        background-color: #7C5CFF;
        color: #ffffff;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        margin-right: 8px;
        margin-bottom: 6px;
        transition: all 0.2s ease;
    `;

    btn.addEventListener("mouseover", () => {
        if (!btn.dataset.done) btn.style.backgroundColor = "#6A48F5";
    });
    btn.addEventListener("mouseout", () => {
        if (!btn.dataset.done) btn.style.backgroundColor = "#7C5CFF";
    });

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        const title = extractStreamingDetailTitle();
        if (!title) {
            btn.textContent = "Anime adı okunamadı!";
            btn.style.backgroundColor = "#ef4444";
            return;
        }

        btn.textContent = "AniList'te aranıyor...";
        btn.style.backgroundColor = "#9B82FF";

        chrome.runtime.sendMessage({
            action: "addFromTitle",
            title: title,
            pageUrl: window.location.href,
            currentEpisode: 0
        }, (response) => {
            if (response && response.success) {
                const name = response.animeName || title;
                const shortName = name.length > 20 ? name.substring(0, 18) + "..." : name;
                btn.textContent = `Eklendi: ${shortName} ✓`;
                btn.style.backgroundColor = "#10b981";
                btn.dataset.done = "true";
            } else {
                const isDup = response?.error?.toLowerCase().includes("duplicate") || response?.error?.toLowerCase().includes("zaten");
                btn.textContent = isDup ? "Zaten Listede" : (response?.error || "Hata!");
                btn.style.backgroundColor = isDup ? "#f59e0b" : "#ef4444";
            }
        });
    });

    // Satırın en başına veya ilgili butonun yanına yerleştir
    refBtn.parentElement.insertBefore(btn, refBtn);
}

// ------------------------------------------------------------
// 3. Anizium (veya TrAnimeİzle) Video İzleme Sayfası (Görsel 4)
// ------------------------------------------------------------
function addStreamingUpdateButton() {
    const url = window.location.href;
    const isWatch = url.includes("anizium.co/watch") || url.includes("anizium.com/watch") || url.includes("tranimeizle.top/izle") || url.includes("turkanime.co/video");
    const hasEpisode = extractEpisodeNumber(url) > 0;
    const isInvalidPage = url.includes("/animes") || (!isWatch && !hasEpisode);

    let existingBtn = document.querySelector(".update-watch-status-btn");

    if (isInvalidPage) {
        if (existingBtn) existingBtn.remove();
        return;
    }
    
    // Eğer buton zaten doğru yerdeyse (body'de uçmuyorsa) devam et. Uçuyorsa silip tekrar yapalım.
    if (existingBtn) {
        if (existingBtn.parentElement !== document.body) return;
        existingBtn.remove(); // Body'deyse sil, tekrar deneyeceğiz
    }

    const button = document.createElement("button");
    button.className = "update-watch-status-btn";
    button.textContent = "Kiroku: İzlendi İşaretle";

    // 1. Anizium Watch Sayfası: Görsel 4'teki kontrol barına yerleştir
    if (url.includes("anizium.co") || url.includes("anizium.com")) {
        const allElements = Array.from(document.querySelectorAll("*"));
        // En derindeki elementi bulmak için diziyi sondan başa taramak veya filter yapıp sonuncuyu almak mantıklıdır.
        const findDeepest = (texts) => {
            const matches = allElements.filter(el => {
                if (el.children.length > 2) return false; // Çok fazla çocuğu olanları atla
                const txt = el.textContent.trim().toLowerCase();
                return texts.some(t => txt === t || txt.includes(t));
            });
            return matches.length > 0 ? matches[matches.length - 1] : null;
        };

        // Sitenin kendi "İzledim olarak işaretle" onay kutusunun yanına; görünüm sitenin "Hata Bildir" butonundan kopyalanır
        const firstExact = (texts) => allElements.find(el => el.children.length <= 2 && texts.includes(el.textContent.trim().toLowerCase()));
        const siteMark = firstExact(["izledim olarak işaretle", "mark as watched", "izlendi olarak işaretle"]);
        const siteBtn = firstExact(["hata bildir", "report an issue", "sorun bildir"]);
        if (siteMark && siteMark.parentElement) {
            if (siteBtn) {
                const cs = getComputedStyle(siteBtn);
                button.className = `${siteBtn.className || ""} update-watch-status-btn`.trim();
                for (const prop of ["backgroundColor", "color", "font", "padding", "borderRadius", "border", "lineHeight", "boxShadow"]) button.style[prop] = cs[prop];
            } else {
                button.style.cssText = "padding:6px 12px;background:#6c757d;color:#fff;border:0;border-radius:3px;font-size:14px;";
            }
            button.style.marginLeft = "12px";
            button.style.cursor = "pointer";
            button.style.verticalAlign = "middle";
            button.textContent = "Kiroku'ya işle";
            button.dataset.siteStyled = "1";
            siteMark.insertAdjacentElement("afterend", button);
            bindUpdateButtonEvent(button);
            return;
        }

        const reportBtn = findDeepest(["report an issue", "sorun bildir", "hata bildir"]);
        const markWatched = findDeepest(["mark as watched", "izlendi olarak işaretle", "izledim olarak işaretle"]);
        const prevNextBtn = findDeepest(["previous episode", "next episode"]);

        const targetAnchor = reportBtn || markWatched || prevNextBtn;
        if (targetAnchor && targetAnchor.parentElement) {
            button.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 14px;
                background-color: #7C5CFF;
                color: #ffffff;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 4px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                margin-left: 12px;
                transition: all 0.2s;
            `;
            targetAnchor.parentElement.appendChild(button);
            bindUpdateButtonEvent(button);
            return;
        }
    }

    // 2. Tranimeizle Playlist Title
    if (url.includes("tranimeizle.top")) {
        const playlistTitle = document.querySelector(".playlist-title");
        if (playlistTitle) {
            playlistTitle.style.display = "flex";
            playlistTitle.style.justifyContent = "space-between";
            playlistTitle.style.alignItems = "center";
            playlistTitle.style.flexWrap = "wrap";
            button.style.cssText = `
                display: inline-block; padding: 6px 14px; background-color: #7C5CFF;
                color: #fff; text-decoration: none; border-radius: 6px; font-size: 13px;
                font-weight: 500; cursor: pointer; transition: all 0.2s; border: none;
            `;
            playlistTitle.appendChild(button);
            bindUpdateButtonEvent(button);
            return;
        }
    }

    // 3. Fallback: Ekranın sol alt köşesinde sabit buton
    attachFloatingButton(button);
    bindUpdateButtonEvent(button);
}

function bindUpdateButtonEvent(button) {
    button.addEventListener("click", (e) => {
        e.preventDefault();
        const epData = getStreamingEpisodeData();
        if (!epData || !epData.name) {
            button.textContent = "Hata: Anime adı bulunamadı";
            button.style.backgroundColor = "#ef4444";
            return;
        }

        const originalText = button.textContent;
        const originalBg = button.style.backgroundColor;
        button.textContent = "Güncelleniyor...";

        chrome.runtime.sendMessage({
            action: "updateAnimeStatus",
            data: {
                name: epData.name,
                watchStatus: epData.currentEpisode
            }
        }, (response) => {
            if (response && response.success) {
                const epText = epData.currentEpisode > 0 ? `Bölüm ${epData.currentEpisode}` : "Durum";
                button.textContent = `${epText} Güncellendi ✓`;
                button.style.backgroundColor = "#10b981";
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.backgroundColor = originalBg;
                }, 2500);
            } else {
                const isNotFound = response?.error?.toLowerCase().includes("not found") || response?.error?.toLowerCase().includes("bulunamadı");
                if (isNotFound) {
                    button.textContent = "Bulunamadı: Listeye Ekle?";
                    button.style.backgroundColor = "#f59e0b";
                    button.onclick = (ev) => {
                        ev.preventDefault();
                        button.textContent = "AniList'te aranıyor...";
                        chrome.runtime.sendMessage({
                            action: "addFromTitle",
                            title: epData.name,
                            pageUrl: window.location.href,
                            currentEpisode: epData.currentEpisode
                        }, (addRes) => {
                            if (addRes && addRes.success) {
                                button.textContent = `Eklendi (Bölüm ${epData.currentEpisode}) ✓`;
                                button.style.backgroundColor = "#10b981";
                            } else {
                                button.textContent = "Hata: " + (addRes?.error || "Eklenemedi");
                                button.style.backgroundColor = "#ef4444";
                            }
                        });
                    };
                } else {
                    button.textContent = "Hata: " + (response?.error || "Kayıt başarısız");
                    button.style.backgroundColor = "#ef4444";
                }
            }
        });
    });
}

function attachFloatingButton(button) {
    button.style.cssText = `
        display: inline-block; padding: 8px 16px; background-color: #7C5CFF;
        color: #fff; text-decoration: none; border-radius: 6px; font-size: 13px;
        font-weight: 500; cursor: pointer; position: fixed; bottom: 20px; left: 20px;
        border: none; z-index: 2147483646; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: all 0.2s;
    `;
    button.addEventListener("mouseover", () => button.style.backgroundColor = "#6A48F5");
    button.addEventListener("mouseout", () => button.style.backgroundColor = "#7C5CFF");
    document.body.appendChild(button);
}

// ------------------------------------------------------------
// İzlemeyi algıla: izleme sayfasında bir süre kalınca "kaydedelim mi / puanlayalım mı" diye sorar
// ------------------------------------------------------------
const WATCH_PROMPT_DELAY_MS = 90_000;
let watchPromptKey = '';
let watchPromptTimer = null;

function isWatchPage() {
    const url = location.href;
    return (url.includes('anizium.co/watch') || url.includes('anizium.com/watch') || url.includes('tranimeizle.top/izle') || url.includes('turkanime.co/video')) && extractEpisodeNumber(url) > 0;
}

function scheduleWatchPrompt() {
    if (!isTopFrame || !extensionEnabled || !isWatchPage()) {
        clearTimeout(watchPromptTimer); watchPromptTimer = null; watchPromptKey = '';
        document.getElementById('kiroku-watch-prompt')?.remove();
        return;
    }
    const key = location.href;
    if (key === watchPromptKey) return;
    watchPromptKey = key;
    clearTimeout(watchPromptTimer);
    watchPromptTimer = setTimeout(() => {
        chrome.storage.local.get(['watch_prompt', 'watch_prompted'], (data) => {
            if (data.watch_prompt === false) return;
            const ep = getStreamingEpisodeData();
            if (!ep.name || document.hidden) return;
            const id = `${ep.name}#${ep.currentEpisode}`;
            const done = data.watch_prompted || {};
            if (done[id]) return;
            done[id] = Date.now();
            // Eski kayıtları temizle (en fazla 200)
            const keys = Object.keys(done).sort((a, b) => done[a] - done[b]);
            while (keys.length > 200) delete done[keys.shift()];
            chrome.storage.local.set({ watch_prompted: done });
            showWatchPrompt(ep);
        });
    }, WATCH_PROMPT_DELAY_MS);
}

function showWatchPrompt(ep) {
    document.getElementById('kiroku-watch-prompt')?.remove();
    const box = document.createElement('div');
    box.id = 'kiroku-watch-prompt';
    box.style.cssText = 'position:fixed;right:20px;bottom:80px;z-index:2147483647;max-width:300px;padding:14px;border-radius:10px;background:rgba(18,18,18,.95);color:#fff;font:13px system-ui,sans-serif;border:1px solid rgba(255,255,255,.12);box-shadow:0 6px 20px rgba(0,0,0,.5)';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;margin-bottom:8px';
    title.textContent = `${ep.name} · Bölüm ${ep.currentEpisode} izleniyor. Kiroku'ya kaydedelim mi?`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
    const score = document.createElement('select');
    score.style.cssText = 'background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:4px';
    score.innerHTML = '<option value="">Puan yok</option>' + Array.from({ length: 10 }, (_, i) => `<option value="${10 - i}">${10 - i}</option>`).join('');
    const mk = (label, bg) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `background:${bg};color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit`; return b; };
    const yes = mk('Kaydet', '#7C5CFF');
    const no = mk('Hayır', '#444');
    const msg = document.createElement('div');
    msg.style.cssText = 'margin-top:8px;font-size:12px';
    yes.onclick = () => {
        yes.disabled = true; msg.textContent = 'Kaydediliyor…';
        const data = { name: ep.name, watchStatus: ep.currentEpisode };
        if (score.value) data.score = Number(score.value);
        chrome.runtime.sendMessage({ action: 'updateAnimeStatus', data }, (res) => {
            if (res && res.success) { msg.textContent = `Bölüm ${ep.currentEpisode} kaydedildi ✓`; setTimeout(() => box.remove(), 2500); }
            else { msg.textContent = (res && res.error) || 'Kaydedilemedi'; yes.disabled = false; }
        });
    };
    no.onclick = () => box.remove();
    row.append(score, yes, no);
    box.append(title, row, msg);
    document.body.appendChild(box);
}

function removeSyncerButtons() {
    document.querySelectorAll(".add-to-anisync-mal-btn, .add-to-anisync-detail-btn, .update-watch-status-btn").forEach(el => el.remove());
    document.getElementById("kiroku-watch-prompt")?.remove();
}

function initSyncerButtons() {
    if (!extensionEnabled) {
        removeSyncerButtons();
        return;
    }
    addMALWatchlistButton();
    addAniziumDetailWatchlistButton();
    addStreamingUpdateButton();
    scheduleWatchPrompt();
}

// SPA Sayfa Değişiklikleri ve Dinamik Yüklemeler için MutationObserver
let domChangeTimeout = null;
const observer = new MutationObserver(() => {
    if (domChangeTimeout) clearTimeout(domChangeTimeout);
    domChangeTimeout = setTimeout(() => {
        if (isTopFrame && extensionEnabled) {
            initSyncerButtons();
        }
    }, 400);
});
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });


// ============================================================
// PART 3: Popup Request Listeners (getAnimeInfo & getEpisodeInfo)
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'blink_indicator') {
        flashIndicator();
        return;
    }

    if (request.action === "extensionToggled") {
        extensionEnabled = request.enabled;
        if (!extensionEnabled) removeSyncerButtons();
        else initSyncerButtons();
        return;
    }

    if (request.action === "getAnimeInfo") {
        const info = getMALAnimeData() || getAniziumDetailData();
        sendResponse({ animeInfo: info });
        return true;
    }

    if (request.action === "getAnimeTitle") {
        sendResponse({ title: extractStreamingDetailTitle() });
        return true;
    }

    if (request.action === "getEpisodeInfo") {
        const epData = getStreamingEpisodeData();
        sendResponse({
            episodeInfo: epData && epData.name ? {
                name: epData.name,
                watchStatus: epData.currentEpisode
            } : null
        });
        return true;
    }
});

// Arka plandan gelen otomatik 'izlendi' tetikleyicisi
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'aniziumWatchedTriggered') {
        const epData = getStreamingEpisodeData();
        if (epData && epData.name) {
            console.log('AniSync: Anizium otomatik izlendi istegi yakalandi. Guncelleniyor...', epData);
            chrome.runtime.sendMessage({
                action: 'updateAnimeStatus',
                data: { name: epData.name, watchStatus: epData.currentEpisode }
            }, (res) => {
                const btn = document.querySelector('.update-watch-status-btn');
                if (btn) {
                    if (res && res.success) {
                        btn.textContent = 'Otomatik Guncellendi \u2713';
                        btn.style.backgroundColor = '#10b981';
                    }
                }
            });
        }
    }
});

// ============================================================
// PART 3: Kiroku köprüsü — açık anime sekmelerini Kiroku sayfasına verir
// Yalnızca Kiroku sayfalarında ve üst çerçevede dinlenir; sekmeler arka planda anime sitelerine göre süzülür.
// ============================================================

const KIROKU_ORIGINS = ['https://app.dogukankirali.com', 'https://kiroku.dogukankirali.workers.dev', 'http://localhost:3000'];

if (isTopFrame && KIROKU_ORIGINS.includes(location.origin)) {
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const msg = event.data;
        if (msg && msg.source === 'kiroku-page' && msg.type === 'MANGA_CATCH_UP') {
            chrome.runtime.sendMessage({ action: 'openMangaCatchUp', title: String(msg.title || ''), series: String(msg.series || ''), after: Number(msg.after) || 0 }, (response) => {
                const ok = !chrome.runtime.lastError && !!(response && response.ok);
                window.postMessage({ source: 'kiroku-extension', type: 'MANGA_CATCH_UP_ACK', id: msg.id, ok }, location.origin);
            });
            return;
        }
        if (!msg || msg.source !== 'kiroku-page' || msg.type !== 'GET_OPEN_TABS') return;
        chrome.runtime.sendMessage({ action: 'getOpenAnimeTabs' }, (response) => {
            const tabs = (!chrome.runtime.lastError && response && response.tabs) || [];
            window.postMessage({ source: 'kiroku-extension', type: 'OPEN_TABS', id: msg.id, tabs }, location.origin);
        });
    });
}
