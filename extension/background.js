// ============================================================
// AniTracker Pro + AniSyncer Unified Background Service Worker
// ============================================================

function updateExtensionBadge() {
    chrome.storage.local.get(["extension_enabled", "service_url"], (result) => {
        if (!result.service_url) {
            chrome.action.setBadgeText({ text: "!" });
            chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
        } else if (result.extension_enabled !== false) {
            chrome.action.setBadgeText({ text: "●" });
            chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
        } else {
            chrome.action.setBadgeText({ text: "●" });
            chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
        }
    });
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['trackingActive', 'totalSkips', 'animeHistory', 'theme', 'extension_enabled'], (data) => {
        const defaults = {};
        if (data.trackingActive === undefined) defaults.trackingActive = false;
        if (data.totalSkips === undefined) defaults.totalSkips = 0;
        if (data.anime === undefined) defaults.anime = null;
        if (data.tempo === undefined) defaults.tempo = 5;
        if (data.overlayMode === undefined) defaults.overlayMode = 'detailed';
        if (data.animeHistory === undefined) defaults.animeHistory = {};
        if (data.theme === undefined) defaults.theme = 'dark';
        if (data.extension_enabled === undefined) defaults.extension_enabled = true;

        if (Object.keys(defaults).length > 0) {
            chrome.storage.local.set(defaults);
        }
    });
    updateExtensionBadge();
});

chrome.runtime.onStartup.addListener(() => {
    updateExtensionBadge();
});

// ============================================================
// Skip & URL Tracking State (AniTracker Core)
// ============================================================

let pendingSkips = 0;
let isUpdating = false;

function handleUrlChange(newUrl) {
    chrome.storage.local.get(['trackingActive', 'anime', 'animeHistory'], (data) => {
        if (data.trackingActive && data.anime) {
            let hist = data.animeHistory || {};
            let entry = hist[data.anime.dbId];
            if (entry) {
                let stats = entry.stats || [];
                if (stats.length === 0 || stats[stats.length - 1].url !== newUrl) {
                    stats.push({ url: newUrl, skips: 0 });
                    entry.stats = stats;
                    chrome.storage.local.set({ animeHistory: hist });
                }
            }
        }
    });
}

function processSkips(currentUrl) {
    if (isUpdating || pendingSkips === 0) return;
    isUpdating = true;
    
    const skipsToAdd = pendingSkips;
    pendingSkips = 0;
    
    chrome.storage.local.get(['trackingActive', 'totalSkips', 'anime', 'animeHistory'], (data) => {
        if (data.trackingActive && data.anime) {
            const newTotal = (data.totalSkips || 0) + skipsToAdd;
            
            let hist = data.animeHistory || {};
            let entry = hist[data.anime.dbId] || { status: 'watching', skips: 0, score: null, stats: [], title: data.anime.title, image: data.anime.image };
            
            entry.skips = newTotal;
            entry.status = entry.status === 'completed' ? 'completed' : 'watching';
            
            if (!entry.stats) entry.stats = [];
            if (entry.stats.length === 0) {
                entry.stats.push({ url: currentUrl || 'Bilinmeyen Bölüm', skips: skipsToAdd });
            } else {
                entry.stats[entry.stats.length - 1].skips += skipsToAdd;
            }
            
            hist[data.anime.dbId] = entry;

            chrome.storage.local.set({ totalSkips: newTotal, animeHistory: hist }, () => {
                isUpdating = false;
                processSkips(currentUrl);
            });
        } else {
            isUpdating = false;
            pendingSkips = 0;
        }
    });
}

// ============================================================
// Message Listener (Unified: Skip + AniSyncer)
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Kiroku sayfası açık anime sekmelerini ister (yalnızca Kiroku sayfasındaki içerik betiği gönderir)
    if (request.action === 'getOpenAnimeTabs') {
        const KIROKU_ORIGINS = ['https://app.dogukankirali.com', 'https://kiroku.dogukankirali.workers.dev', 'http://localhost:3000'];
        let senderOrigin = '';
        try { senderOrigin = new URL(sender.url || '').origin; } catch (e) {}
        if (!KIROKU_ORIGINS.includes(senderOrigin)) { sendResponse({ tabs: [] }); return; }
        const ANIME_HOSTS = /(^|\.)(anizium\.(com|co)|tranimeizle\.(top|co|net|com)|turkanime\.(co|tv|net)|myanimelist\.net|anilist\.co)$/i;
        chrome.tabs.query({}, (tabs) => {
            const list = [];
            for (const tab of tabs || []) {
                let url;
                try { url = new URL(tab.url || ''); } catch (e) { continue; }
                if (!ANIME_HOSTS.test(url.hostname)) continue;
                // MAL/AniList'te yalnızca anime sayfaları (arama, profil vb. değil)
                if (/myanimelist\.net|anilist\.co/i.test(url.hostname) && !/^\/anime\/\d+/.test(url.pathname)) continue;
                list.push({ url: tab.url, title: tab.title || '' });
            }
            sendResponse({ tabs: list });
        });
        return true;
    }

    // 1. AniTracker Mesajları
    if (request.action === 'skip_pressed') {
        pendingSkips++;
        processSkips(request.url);
        return;
    } 
    
    if (request.action === 'url_changed') {
        handleUrlChange(request.url);
        return;
    } 
    
    if (request.action === 'relay_blink') {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, { action: 'blink_indicator' });
        }
        return;
    }

    // 2. AniSyncer Extension Toggle ve Badge
    if (request.action === "toggleExtension") {
        updateExtensionBadge();
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, { action: "extensionToggled", enabled: request.enabled }, () => {});
            }
        });
        return;
    }

    if (request.action === "updateBadge" || request.action === "setBadge" || request.action === "clearBadge") {
        updateExtensionBadge();
        return;
    }

    // 3. AniSyncer Backend API Proxy (Kiroku #26: istekler eklentiden alınan anahtarla Bearer token taşır)
    if (request.action === "addToWatchlist") {
        chrome.storage.local.get(["service_url", "auth_token"], async (result) => {
            const raw = result.service_url || "https://localhost:8080";
            const serviceUrl = raw.trim().replace(/\/+$/, "");
            try {
                const res = await fetch(`${serviceUrl}/api/create-anime`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeader(result.auth_token) },
                    body: JSON.stringify(request.data),
                    credentials: "omit",
                    mode: "cors"
                });
                const text = await res.text();
                let data = null;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    if (text.includes("Client sent an HTTP request to an HTTPS server")) {
                        return sendResponse({ success: false, error: "HTTP yerine HTTPS kullanmalısınız (örn: https://localhost:8080)" });
                    }
                    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
                        return sendResponse({ success: false, error: "Service URL backend portu olmalı (HTML döndü)" });
                    }
                    return sendResponse({ success: false, error: text || `Hata (${res.status})` });
                }
                if (!res.ok) {
                    return sendResponse({ success: false, error: res.status === 401 ? LOGIN_REQUIRED : data?.error || data?.message || `Hata (${res.status})` });
                }
                sendResponse({ success: true, data });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        });
        return true;
    }

    if (request.action === "updateAnimeStatus") {
        chrome.storage.local.get(["service_url", "auth_token"], async (result) => {
            const raw = result.service_url || "https://localhost:8080";
            const serviceUrl = raw.trim().replace(/\/+$/, "");
            try {
                // 1. AniList'te ara ve resmi (temiz) ismi al
                let canonicalTitle = request.data.name;
                try {
                    const query = `query ($search: String) {
                        Page(page: 1, perPage: 1) {
                            media(search: $search, type: ANIME) {
                                title {
                                    romaji
                                    english
                                }
                            }
                        }
                    }`;
                    const alRes = await fetch("https://graphql.anilist.co", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Accept": "application/json" },
                        body: JSON.stringify({ query, variables: { search: request.data.name } })
                    });
                    const alJson = await alRes.json();
                    const media = alJson?.data?.Page?.media?.[0];
                    if (media) {
                        canonicalTitle = media.title.romaji || media.title.english || request.data.name;
                    }
                } catch (e) {
                    console.warn("AniList arama hatası:", e);
                }

                // 2. Temizlenen ismi backend'e gönder
                request.data.name = canonicalTitle;

                const res = await fetch(`${serviceUrl}/api/anime/update-episode`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeader(result.auth_token) },
                    body: JSON.stringify(request.data),
                    credentials: "omit",
                    mode: "cors"
                });
                const text = await res.text();
                let data = null;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    if (text.includes("Client sent an HTTP request to an HTTPS server")) {
                        return sendResponse({ success: false, error: "HTTP yerine HTTPS kullanmalısınız (örn: https://localhost:8080)" });
                    }
                    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
                        return sendResponse({ success: false, error: "Service URL backend portu olmalı (HTML döndü)" });
                    }
                    return sendResponse({ success: false, error: text || `Hata (${res.status})` });
                }
                if (!res.ok) {
                    return sendResponse({ success: false, error: res.status === 401 ? LOGIN_REQUIRED : data?.error || data?.message || `Hata (${res.status})` });
                }
                sendResponse({ success: true, data });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        });
        return true;
    }

    if (request.action === "addFromTitle") {
        const title = request.title;
        const pageUrl = request.pageUrl || "";
        chrome.storage.local.get(["service_url", "auth_token"], async (result) => {
            const raw = result.service_url || "https://localhost:8080";
            const serviceUrl = raw.trim().replace(/\/+$/, "");

            try {
                // 1. AniList'te ara ve zengin metadata al
                let media = null;
                try {
                    const query = `query ($search: String) {
                        Page(page: 1, perPage: 1) {
                            media(search: $search, type: ANIME) {
                                id
                                idMal
                                title {
                                    romaji
                                    english
                                    native
                                }
                                episodes
                                status
                                coverImage {
                                    extraLarge
                                    large
                                }
                                genres
                                format
                            }
                        }
                    }`;
                    const alRes = await fetch("https://graphql.anilist.co", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Accept": "application/json" },
                        body: JSON.stringify({ query, variables: { search: title } })
                    });
                    const alJson = await alRes.json();
                    media = alJson?.data?.Page?.media?.[0] || null;
                } catch (alErr) {
                    console.warn("AniList arama hatası, yerel başlık kullanılacak:", alErr);
                }

                let animeData;
                if (media) {
                    const canonicalTitle = media.title.romaji || media.title.english || title;
                    animeData = {
                        Name: canonicalTitle,
                        AnimeStatus: media.status === "FINISHED" ? "Finished Airing" : (media.status === "RELEASING" ? "Currently Airing" : "Not yet aired"),
                        WatchStatus: request.currentEpisode || 0,
                        TotalNumberOfEpisodes: media.episodes || 0,
                        IsMovie: media.format === "MOVIE",
                        Score: -1,
                        MALScore: 0,
                        Notes: "",
                        Genre: (media.genres || []).join(", "),
                        MALAnimeLink: media.idMal ? `https://myanimelist.net/anime/${media.idMal}` : "",
                        Cover: media.coverImage?.extraLarge || media.coverImage?.large || "",
                        AnimeLink: pageUrl,
                        Series: 0,
                        PlanToWatch: true
                    };
                } else {
                    animeData = {
                        Name: title,
                        AnimeStatus: "Currently Airing",
                        WatchStatus: request.currentEpisode || 0,
                        TotalNumberOfEpisodes: 0,
                        IsMovie: false,
                        Score: -1,
                        MALScore: 0,
                        Notes: "",
                        Genre: "",
                        MALAnimeLink: "",
                        Cover: "",
                        AnimeLink: pageUrl,
                        Series: 0,
                        PlanToWatch: true
                    };
                }

                // 2. Backend'e kaydet
                const res = await fetch(`${serviceUrl}/api/create-anime`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeader(result.auth_token) },
                    body: JSON.stringify(animeData),
                    credentials: "omit",
                    mode: "cors"
                });

                const text = await res.text();
                let data = null;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    if (text.includes("Client sent an HTTP request to an HTTPS server")) {
                        return sendResponse({ success: false, error: "HTTP yerine HTTPS kullanmalısınız (örn: https://localhost:8080)" });
                    }
                    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
                        return sendResponse({ success: false, error: "Service URL backend portu olmalı (HTML döndü)" });
                    }
                    return sendResponse({ success: false, error: text || `Hata (${res.status})` });
                }

                if (!res.ok) {
                    return sendResponse({ success: false, error: res.status === 401 ? LOGIN_REQUIRED : data?.error || data?.message || `Hata (${res.status})` });
                }

                sendResponse({ success: true, animeName: animeData.Name, data });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        });
        return true;
    }
});

// Anizium otomatik izlendi API yakalayici
chrome.webRequest.onCompleted.addListener(
    function(details) {
        if (details.url.includes('api.anizium.co/anime/watched')) {
            console.log('Anizium watched API called!', details);
            if (details.tabId >= 0) {
                chrome.tabs.sendMessage(details.tabId, { action: 'aniziumWatchedTriggered' }).catch(() => {});
            }
        }
    },
    { urls: ['*://api.anizium.co/anime/watched*'] }
);

// Kiroku hesabı: Configs sekmesinden giriş yapınca alınan eklenti anahtarı
function authHeader(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}
const LOGIN_REQUIRED = "Kiroku hesabına giriş yapılmamış ya da anahtar iptal edilmiş. Eklentide Configs sekmesinden giriş yap.";

// ============================================================
// Dijital manga okuma: okuma sitelerindeki içerik betiği son okunan bölümü buradan Kiroku'ya yazar
// (içerik betiği Kiroku'ya doğrudan istek atamaz). Gövde: { mangaId?, title, chapter, url }.
// 404'te Kiroku benzer adları (candidates) döner; içerik betiği kullanıcıya seçtirip mangaId ile tekrar dener.
// ============================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== "saveMangaProgress" && request.action !== "searchKirokuManga") return;
    chrome.storage.local.get(["service_url", "auth_token"], async (result) => {
        const serviceUrl = (result.service_url || "").trim().replace(/\/+$/, "");
        if (!serviceUrl) return sendResponse({ success: false, error: "Eklentide Service URL ayarlı değil" });
        try {
            const res = request.action === "saveMangaProgress"
                ? await fetch(`${serviceUrl}/api/manga/digital-progress`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...authHeader(result.auth_token) },
                      body: JSON.stringify(request.data),
                      credentials: "omit",
                  })
                : await fetch(`${serviceUrl}/api/manga?q=${encodeURIComponent(request.q || "")}&count=8`, {
                      headers: authHeader(result.auth_token),
                      credentials: "omit",
                  });
            const data = await res.json().catch(() => null);
            if (res.status === 401) return sendResponse({ success: false, error: LOGIN_REQUIRED });
            if (res.status === 404) return sendResponse({ success: false, notFound: true, candidates: data?.candidates || [], error: data?.message });
            if (!res.ok) return sendResponse({ success: false, error: data?.message || `Hata (${res.status})` });
            sendResponse({ success: true, data });
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
    });
    return true;
});
