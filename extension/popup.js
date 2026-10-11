// ============================================================
// AniTracker Pro + AniSyncer Unified Popup Script
// ============================================================

// --- UI Elements (Tracker) ---
const ui = {
    themeBtn: document.getElementById('theme-toggle'),
    search: document.getElementById('search'),
    dropdown: document.getElementById('dropdown'),
    animeCard: document.getElementById('anime-card'),
    seasonInput: document.getElementById('season-input'),
    tempo: document.getElementById('tempo'),
    tempoVal: document.getElementById('tempo-val'),
    trackBtn: document.getElementById('toggle-track'),
    skipMinus: document.getElementById('skip-minus'),
    skipPlus: document.getElementById('skip-plus'),
    skipInput: document.getElementById('skip-input'),
    btnShowScore: document.getElementById('btn-show-score'),
    scoreContainer: document.getElementById('score-container'),
    scoreInput: document.getElementById('score-input'),
    btnCalc: document.getElementById('btn-calc'),
    btnEditScore: document.getElementById('btn-edit-score'),
    btnSave: document.getElementById('btn-save'),
    btnEditAnime: document.getElementById('btn-edit-anime'),
    btnFinish: document.getElementById('btn-finish'),
    btnDelete: document.getElementById('btn-delete'),
    navTable: document.getElementById('nav-table'),
    navStats: document.getElementById('nav-stats'),
    overlayModeSwitch: document.getElementById('overlay-mode-switch'),
    panels: {
        main: document.getElementById('panel-main'),
        table: document.getElementById('panel-table'),
        stats: document.getElementById('panel-stats')
    }
};

let searchTimeout;
let currentAbortController = null;
let animeHistory = {};

// ============================================================
// 1. TRACKER LOGIC (Mevcut AniTracker Korumalı Kodları)
// ============================================================

chrome.storage.local.get(null, (data) => {
    const theme = data.theme || 'dark';
    document.body.setAttribute('data-theme', theme);
    ui.themeBtn.innerText = theme === 'light' ? '🌙' : '☀️';
    
    animeHistory = data.animeHistory || {};
    
    if (data.anime) setAnime(data.anime);
    if (data.tempo) { ui.tempo.value = data.tempo; ui.tempoVal.innerText = data.tempo; }
    
    ui.skipInput.value = data.totalSkips || 0;
    ui.overlayModeSwitch.checked = data.overlayMode !== 'minimal';
    
    updateUIStates(data.trackingActive, data.anime);

    // Syncer durumlarını da başlat
    initSyncerUI(data);

    // Açık sekme bir izleme sayfasıysa izlenen animeyi kendiliğinden bul (takip sürerken dokunma)
    if (!data.trackingActive) detectAnimeFromActiveTab(data.anime);
});

// İzleme sitesindeki oynatıcı sayfasından anime adını çıkarır: önce sayfanın başlığı (içerik betiği),
// olmazsa adresteki kısa ad ("sousou-no-frieren-3-bolum-izle" → "sousou no frieren")
function titleFromUrl(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean).filter((p) => !/^(anime|watch|izle|video|episode|bolum|tr|en)$/i.test(p) && !/^\d+$/.test(p));
        const slug = parts.sort((a, b) => b.length - a.length)[0] || '';
        return slug
            .replace(/\.(html?|php)$/i, '')
            .replace(/[-_](\d+)[-_]?(bolum|bölüm|episode|ep)\b.*$/i, '')
            .replace(/[-_](bolum|bölüm|episode|ep)[-_]?\d+.*$/i, '')
            .replace(/[-_](izle|watch|turkce|altyazili)\b.*$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim();
    } catch (e) {
        return '';
    }
}

const STREAMING_HOSTS = ['turkanime.co', 'tranimeizle.top', 'tranimeizle.co', 'anizium.co', 'anizium.com'];

async function detectAnimeFromActiveTab(currentAnime) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !STREAMING_HOSTS.some((h) => new URL(tab.url).hostname.endsWith(h))) return;
        const fromPage = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { action: 'getEpisodeInfo' }, (res) => {
                resolve(!chrome.runtime.lastError && res && res.episodeInfo ? res.episodeInfo.name : '');
            });
        });
        const name = (fromPage || titleFromUrl(tab.url)).trim();
        if (name.length < 3) return;
        const media = await searchAniListOne(name);
        if (!media) return;
        const title = media.title.english || media.title.romaji;
        // Seçili anime zaten buysa bir şey yapma
        if (currentAnime && currentAnime.id === media.id) return;
        const animeData = { id: media.id, title, image: media.coverImage.extraLarge || media.coverImage.large || '', episodes: media.episodes || 12, genres: (media.genres || []).slice(0, 3).join(', ') };
        prepareNewAnime(animeData);
        showDetectedBanner(title);
    } catch (e) {
        // Algılanamazsa elle arama her zamanki gibi çalışır
    }
}

async function searchAniListOne(search) {
    const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            query: `query ($search: String) { Page(perPage: 1) { media(search: $search, type: ANIME) { id title { romaji english } episodes coverImage { extraLarge large } genres } } }`,
            variables: { search },
        }),
    });
    if (!res.ok) return null;
    return (await res.json()).data?.Page?.media?.[0] || null;
}

function showDetectedBanner(title) {
    let el = document.getElementById('detected-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'detected-banner';
        el.className = 'syncer-status';
        el.style.cssText = 'display:block; margin-bottom:8px; font-size:12px;';
        ui.animeCard.parentNode.insertBefore(el, ui.animeCard);
    }
    el.textContent = `🎯 Açık sekmeden algılandı: ${title}. Yanlışsa yukarıdan ara.`;
}

ui.themeBtn.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    ui.themeBtn.innerText = isDark ? '🌙' : '☀️';
    chrome.storage.local.set({ theme: newTheme });
});

ui.overlayModeSwitch.addEventListener('change', (e) => {
    chrome.storage.local.set({ overlayMode: e.target.checked ? 'detailed' : 'minimal' });
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.totalSkips) ui.skipInput.value = changes.totalSkips.newValue;
    if (changes.animeHistory) animeHistory = changes.animeHistory.newValue;
    if (changes.trackingActive) {
        chrome.storage.local.get(['anime'], d => updateUIStates(changes.trackingActive.newValue, d.anime));
    }
    if (changes.extension_enabled) {
        document.getElementById('syncer-toggle').checked = changes.extension_enabled.newValue !== false;
    }
});

function updateUIStates(isTracking, anime) {
    if (isTracking) {
        ui.trackBtn.innerText = 'Takip Devam Ediyor (Durdur)';
        ui.trackBtn.className = 'mat-btn btn-danger w-100 mb-3';
    } else {
        ui.trackBtn.innerText = 'Takibi Başlat';
        ui.trackBtn.className = 'mat-btn btn-primary w-100 mb-3';
    }
    
    const hasAnime = !!anime;
    const dbEntry = hasAnime ? animeHistory[anime.dbId] : null;
    const isCompleted = dbEntry && dbEntry.status === 'completed';
    
    ui.btnCalc.disabled = !hasAnime || isCompleted;
    ui.btnEditScore.disabled = !hasAnime || isCompleted;
    ui.btnSave.disabled = !hasAnime || isCompleted;
    ui.btnFinish.disabled = !hasAnime || isCompleted;
    
    ui.btnEditAnime.disabled = !hasAnime || !isCompleted;
    ui.btnDelete.disabled = !hasAnime || !dbEntry;
    
    ui.btnShowScore.style.display = hasAnime ? 'block' : 'none';
    
    if (dbEntry && dbEntry.score) {
        ui.scoreInput.value = dbEntry.score;
    } else {
        ui.scoreInput.value = '0.0';
    }
    
    ui.scoreInput.readOnly = true;
    ui.scoreInput.style.borderColor = 'transparent';
}

ui.btnShowScore.addEventListener('click', () => {
    const isHidden = ui.scoreContainer.style.display === 'none';
    ui.scoreContainer.style.display = isHidden ? 'flex' : 'none';
    ui.btnShowScore.innerText = isHidden ? 'Puanı Gizle' : 'Puanı Göster';
});

function setManualSkips(newVal) {
    newVal = Math.max(0, parseInt(newVal) || 0);
    ui.skipInput.value = newVal;
    
    chrome.storage.local.get(['anime', 'animeHistory'], (data) => {
        let updateData = { totalSkips: newVal };
        if (data.anime) {
            let hist = data.animeHistory || {};
            let entry = hist[data.anime.dbId] || { status: 'watching', score: null, stats: [], title: data.anime.title, image: data.anime.image };
            entry.skips = newVal;
            hist[data.anime.dbId] = entry;
            updateData.animeHistory = hist;
        }
        chrome.storage.local.set(updateData);
    });
}

ui.skipMinus.addEventListener('click', () => setManualSkips(ui.skipInput.value - 1));
ui.skipPlus.addEventListener('click', () => setManualSkips(parseInt(ui.skipInput.value) + 1));
ui.skipInput.addEventListener('change', (e) => setManualSkips(e.target.value));

async function performSearch(queryText) {
    if (queryText.length < 3) { ui.dropdown.style.display = 'none'; return; }
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();
    
    ui.dropdown.innerHTML = '<div class="dropdown-item" style="justify-content: center; color: var(--text-secondary);">Aranıyor...</div>';
    ui.dropdown.style.display = 'block';

    const graphqlQuery = `query ($search: String) { Page(page: 1, perPage: 5) { media(search: $search, type: ANIME) { id title { romaji english } episodes coverImage { extraLarge large } genres } } }`;

    try {
        const res = await fetch('https://graphql.anilist.co', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ query: graphqlQuery, variables: { search: queryText } }),
            signal: currentAbortController.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        ui.dropdown.innerHTML = '';
        const animes = json.data.Page.media;
        
        if (animes && animes.length > 0) {
            animes.forEach(anime => {
                const div = document.createElement('div');
                div.className = 'dropdown-item';
                const title = anime.title.english || anime.title.romaji;
                const imgUrl = anime.coverImage.extraLarge || anime.coverImage.large || '';
                
                div.innerHTML = `<img src="${imgUrl}" alt="poster"> <span>${title}</span>`;
                div.onclick = () => {
                    const animeData = { id: anime.id, title: title, image: imgUrl, episodes: anime.episodes || 12, genres: (anime.genres || []).slice(0, 3).join(', ') };
                    prepareNewAnime(animeData);
                };
                ui.dropdown.appendChild(div);
            });
            ui.dropdown.style.display = 'block';
        } else {
            ui.dropdown.innerHTML = '<div class="dropdown-item" style="justify-content: center;">Sonuç bulunamadı.</div>';
        }
    } catch(e) { 
        if (e.name === 'AbortError') return;
        ui.dropdown.innerHTML = '<div class="dropdown-item" style="justify-content: center; color: var(--danger);">Arama hatası!</div>';
    }
}

ui.search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimeout); performSearch(e.target.value.trim()); } });
ui.search.addEventListener('input', (e) => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { performSearch(e.target.value.trim()); }, 800); });
ui.search.addEventListener('focus', () => { if(ui.dropdown.innerHTML !== '') ui.dropdown.style.display = 'block'; });

function prepareNewAnime(animeData) {
    ui.dropdown.style.display = 'none';
    ui.search.value = '';
    ui.seasonInput.value = "1";
    animeData.season = 1;
    animeData.dbId = `${animeData.id}_S1`;
    loadAnimeToUI(animeData);
}

ui.seasonInput.addEventListener('change', (e) => {
    let s = Math.max(1, parseInt(e.target.value) || 1);
    ui.seasonInput.value = s;
    chrome.storage.local.get(['anime'], data => {
        if(data.anime) {
            data.anime.season = s;
            data.anime.dbId = `${data.anime.id}_S${s}`;
            loadAnimeToUI(data.anime);
        }
    });
});

function loadAnimeToUI(animeData) {
    let startSkips = 0;
    const historyData = animeHistory[animeData.dbId];
    if (historyData) startSkips = historyData.skips || 0;
    
    chrome.storage.local.set({ anime: animeData, totalSkips: startSkips, trackingActive: false });
    ui.skipInput.value = startSkips;
    setAnime(animeData);
    updateUIStates(false, animeData);
}

function setAnime(anime) {
    ui.animeCard.style.display = 'flex';
    document.getElementById('anime-img').src = anime.image;
    document.getElementById('anime-title').innerText = anime.title;
    document.getElementById('anime-genres').innerText = anime.genres;
    ui.seasonInput.value = anime.season || 1;
}

ui.tempo.addEventListener('input', (e) => { ui.tempoVal.innerText = e.target.value; chrome.storage.local.set({ tempo: parseInt(e.target.value) }); });

ui.trackBtn.addEventListener('click', () => {
    chrome.storage.local.get(['trackingActive', 'anime'], (data) => {
        if (!data.anime) return alert('Lütfen arama kutusundan bir anime seçin!');
        chrome.storage.local.set({ trackingActive: !data.trackingActive });
    });
});

function getCalculatedScore(eps, skips, tempo) {
    const A = skips / eps;
    const T = 0.5 + (tempo * 0.11);
    const penalty = A * 2.5 * T;
    const rawScore = Math.max(0, 100 - penalty);
    const bonus = Math.min(10, eps * 0.2);
    return Math.min(100, rawScore + bonus) / 10;
}

ui.btnCalc.addEventListener('click', () => {
    chrome.storage.local.get(['anime', 'tempo', 'totalSkips'], (data) => {
        if (!data.anime) return;
        const eps = Math.max(1, data.anime.episodes);
        const score = getCalculatedScore(eps, data.totalSkips || 0, data.tempo || 5);
        ui.scoreInput.value = score.toFixed(1);
    });
});

ui.btnEditScore.addEventListener('click', () => {
    ui.scoreInput.readOnly = false;
    ui.scoreInput.style.borderColor = 'var(--primary)';
    ui.scoreInput.focus();
});

ui.scoreInput.addEventListener('change', (e) => {
    let val = parseFloat(e.target.value);
    if(isNaN(val)) val = 0;
    val = Math.min(10, Math.max(0, val));
    ui.scoreInput.value = val.toFixed(1);
});

ui.btnSave.addEventListener('click', () => {
    chrome.storage.local.get(['anime', 'animeHistory', 'totalSkips'], (data) => {
        if (!data.anime) return;
        let hist = data.animeHistory || {};
        let entry = hist[data.anime.dbId] || { status: 'watching', stats: [], title: data.anime.title, image: data.anime.image };
        entry.skips = data.totalSkips;
        entry.score = ui.scoreInput.value;
        hist[data.anime.dbId] = entry;
        chrome.storage.local.set({ animeHistory: hist }, () => {
            alert('Başarıyla kaydedildi!');
        });
    });
});

ui.btnFinish.addEventListener('click', () => {
    chrome.storage.local.get(['anime', 'animeHistory', 'totalSkips'], (data) => {
        if (!data.anime) return;
        let hist = data.animeHistory || {};
        let entry = hist[data.anime.dbId] || { stats: [], title: data.anime.title, image: data.anime.image };
        entry.status = 'completed';
        entry.skips = data.totalSkips;
        entry.score = ui.scoreInput.value;
        hist[data.anime.dbId] = entry;
        chrome.storage.local.set({ animeHistory: hist, trackingActive: false }, () => {
            updateUIStates(false, data.anime);
        });
    });
});

ui.btnEditAnime.addEventListener('click', () => {
    chrome.storage.local.get(['anime', 'animeHistory'], (data) => {
        if (!data.anime) return;
        let hist = data.animeHistory || {};
        if(hist[data.anime.dbId]) {
            hist[data.anime.dbId].status = 'watching';
            chrome.storage.local.set({ animeHistory: hist }, () => {
                updateUIStates(false, data.anime);
            });
        }
    });
});

ui.btnDelete.addEventListener('click', () => {
    if(confirm('Bu animenin tüm verilerini silmek istediğinize emin misiniz?')) {
        chrome.storage.local.get(['anime', 'animeHistory'], (data) => {
            if (!data.anime) return;
            let hist = data.animeHistory || {};
            delete hist[data.anime.dbId];
            chrome.storage.local.set({ animeHistory: hist, anime: null, totalSkips: 0, trackingActive: false }, () => {
                ui.animeCard.style.display = 'none';
                ui.skipInput.value = '0';
                updateUIStates(false, null);
                ui.scoreContainer.style.display = 'none';
                ui.btnShowScore.innerText = 'Puanı Göster';
            });
        });
    }
});

function showPanel(id) {
    Object.values(ui.panels).forEach(p => p.classList.remove('active'));
    ui.panels[id].classList.add('active');
}

document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => showPanel('main'));
});

ui.navTable.addEventListener('click', () => {
    showPanel('table');
    const container = document.getElementById('table-container');
    container.innerHTML = '';
    
    const keys = Object.keys(animeHistory);
    if(keys.length === 0) {
        container.innerHTML = '<div class="text-center" style="color:var(--text-secondary); padding: 20px;">Kayıt bulunamadı.</div>';
        return;
    }
    
    chrome.storage.local.get(['anime'], data => {
        keys.forEach(k => {
            const entry = animeHistory[k];
            const div = document.createElement('div');
            div.className = 'db-item';
            
            let status = entry.status === 'completed' ? 'Bitirildi' : 'İzleniyor';
            let color = entry.status === 'completed' ? 'var(--success)' : 'var(--secondary)';
            
            div.innerHTML = `
                <img src="${entry.image || ''}" alt="cover">
                <div class="info">
                    <b>${entry.title || k}</b>
                    <span class="badge" style="background:${color}; color:#fff;">${status}</span>
                </div>
                <div style="text-align:right;">
                    <div class="score">${entry.score ? entry.score + '/10' : '-'}</div>
                    <div style="font-size:10px; color:var(--text-secondary);">Skip: ${entry.skips}</div>
                </div>
            `;
            div.onclick = () => {
                if(data.anime && data.anime.dbId === k) showPanel('main');
                else alert('Şu anki animeyi değiştirmek için arama kutusunu kullanın.');
            };
            container.appendChild(div);
        });
    });
});

ui.navStats.addEventListener('click', () => {
    chrome.storage.local.get(['anime'], data => {
        if(!data.anime) { alert('Lütfen önce bir anime seçin.'); return; }
        
        showPanel('stats');
        document.getElementById('stats-title').innerText = data.anime.title + ' İstatistikleri';
        const container = document.getElementById('stats-container');
        container.innerHTML = '';
        
        const entry = animeHistory[data.anime.dbId];
        if(!entry || !entry.stats || entry.stats.length === 0) {
            container.innerHTML = '<div class="text-center" style="color:var(--text-secondary); padding: 20px;">Henüz yeterli veri yok.</div>';
            return;
        }
        
        entry.stats.forEach((st, idx) => {
            const div = document.createElement('div');
            div.className = 'stat-bar';
            div.innerHTML = `
                <div style="color:var(--text-secondary); margin-bottom: 4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">URL: ${st.url}</div>
                <div class="stat-bar-fill">
                    <b>${idx + 1}. Tespit Edilen Kısım</b>
                    <span style="color:var(--danger); font-weight:bold;">${st.skips} Skip</span>
                </div>
            `;
            container.appendChild(div);
        });
    });
});


// ============================================================
// 2. TAB SWITCHER (Tracker vs AniSyncer)
// ============================================================

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.querySelector(`.${tab}-tab`).classList.add('active');
        
        if (tab === 'syncer') {
            checkCurrentPageContext();
        }
    });
});


// ============================================================
// 3. ANISYNCER LOGIC (Local-db-app Entegrasyonu)
// ============================================================

function showSyncerStatus(message, isError = false) {
    const el1 = document.getElementById('syncer-status');
    const el2 = document.getElementById('configs-status');
    const className = `syncer-status ${isError ? 'error' : 'success'}`;
    
    if (el1) {
        el1.textContent = message;
        el1.className = className;
        el1.style.display = 'block';
    }
    if (el2) {
        el2.textContent = message;
        el2.className = className;
        el2.style.display = 'block';
    }

    setTimeout(() => {
        if (el1) { el1.className = 'syncer-status'; el1.style.display = 'none'; }
        if (el2) { el2.className = 'syncer-status'; el2.style.display = 'none'; }
    }, 3500);
}

function initSyncerUI(data) {
    const enabled = data.extension_enabled !== false;
    document.getElementById('syncer-toggle').checked = enabled;

    renderServiceUrl(data.service_url);
    renderDashUrl(data.dashboard_url);
}

function renderServiceUrl(url) {
    const displayEl = document.getElementById('syncer-url-display');
    const inputWrap = document.getElementById('syncer-url-input-wrap');
    const textEl = document.getElementById('syncer-service-url-text');
    
    if (url) {
        displayEl.style.display = 'block';
        inputWrap.style.display = 'none';
        textEl.textContent = url;
    } else {
        displayEl.style.display = 'none';
        inputWrap.style.display = 'block';
    }
}

function renderDashUrl(url) {
    const displayEl = document.getElementById('syncer-dash-display');
    const inputWrap = document.getElementById('syncer-dash-input-wrap');
    const textEl = document.getElementById('syncer-dashboard-url-text');
    
    if (url) {
        displayEl.style.display = 'block';
        inputWrap.style.display = 'none';
        textEl.textContent = url;
    } else {
        displayEl.style.display = 'none';
        inputWrap.style.display = 'block';
    }
}

async function getServiceUrl() {
    return new Promise((resolve) => {
        chrome.storage.local.get("service_url", (result) => {
            resolve(result.service_url || "");
        });
    });
}

async function getDashboardUrl() {
    return new Promise((resolve) => {
        chrome.storage.local.get("dashboard_url", (result) => {
            resolve(result.dashboard_url || "");
        });
    });
}

// Syncer URL Save / Edit Event Listeners
document.getElementById('syncer-toggle').addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ extension_enabled: enabled }, () => {
        chrome.runtime.sendMessage({ action: "toggleExtension", enabled });
        showSyncerStatus(enabled ? 'Extension takibi açıldı.' : 'Extension takibi kapatıldı.');
    });
});

document.getElementById('syncer-save-service-btn').addEventListener('click', () => {
    const input = document.getElementById('syncer-service-input');
    const url = input.value.trim().replace(/\/+$/, '');
    if (!url) return showSyncerStatus('Lütfen geçerli bir Service URL girin!', true);
    chrome.storage.local.set({ service_url: url }, () => {
        renderServiceUrl(url);
        showSyncerStatus('Service URL başarıyla kaydedildi!');
        chrome.runtime.sendMessage({ action: "updateBadge" });
    });
});

document.getElementById('syncer-change-service-btn').addEventListener('click', () => {
    document.getElementById('syncer-url-display').style.display = 'none';
    document.getElementById('syncer-url-input-wrap').style.display = 'block';
    chrome.storage.local.get('service_url', res => {
        document.getElementById('syncer-service-input').value = res.service_url || '';
    });
});

document.getElementById('syncer-save-dash-btn').addEventListener('click', () => {
    const input = document.getElementById('syncer-dash-input');
    const url = input.value.trim().replace(/\/+$/, '');
    if (!url) return showSyncerStatus('Lütfen geçerli bir Dashboard URL girin!', true);
    chrome.storage.local.set({ dashboard_url: url }, () => {
        renderDashUrl(url);
        showSyncerStatus('Dashboard URL başarıyla kaydedildi!');
    });
});

document.getElementById('syncer-change-dash-btn').addEventListener('click', () => {
    document.getElementById('syncer-dash-display').style.display = 'none';
    document.getElementById('syncer-dash-input-wrap').style.display = 'block';
    chrome.storage.local.get('dashboard_url', res => {
        document.getElementById('syncer-dash-input').value = res.dashboard_url || '';
    });
});

document.getElementById('syncer-quick-open-wl').addEventListener('click', async () => {
    const dashboardUrl = await getDashboardUrl();
    if (dashboardUrl) {
        chrome.tabs.create({ url: `${dashboardUrl}/watchlist` });
    } else {
        showSyncerStatus('Dashboard URL girilmemiş!', true);
    }
});

// Kiroku hesabı (#26): kullanıcı adı/şifre ile eklentiye özel bir anahtar alınır, şifre saklanmaz.
// Anahtar Kiroku'da Profil sayfasından iptal edilebilir.
function renderAccount(user) {
    document.getElementById('syncer-account-display').style.display = user ? 'block' : 'none';
    document.getElementById('syncer-login-wrap').style.display = user ? 'none' : 'block';
    document.getElementById('syncer-account-text').textContent = user ? `Giriş yapıldı: ${user}` : '';
}

chrome.storage.local.get(['auth_token', 'auth_user'], (res) => renderAccount(res.auth_token ? res.auth_user || '✓' : null));

async function loginToKiroku() {
    const username = document.getElementById('syncer-login-user').value.trim();
    const password = document.getElementById('syncer-login-pass').value;
    if (!username || !password) return showSyncerStatus('Kullanıcı adı ve şifre gerekli.', true);
    const serviceUrl = (await getServiceUrl()).trim().replace(/\/+$/, '');
    if (!serviceUrl) return showSyncerStatus('Önce Service URL girin.', true);
    try {
        const data = await safeFetchJson(`${serviceUrl}/api/auth/extension-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, name: `Tarayıcı eklentisi (${navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Chrome'})` }),
            credentials: 'omit',
            mode: 'cors'
        });
        chrome.storage.local.set({ auth_token: data.token, auth_user: data.username }, () => {
            document.getElementById('syncer-login-pass').value = '';
            renderAccount(data.username);
            showSyncerStatus(`✅ ${data.username} olarak giriş yapıldı.`);
        });
    } catch (err) {
        showSyncerStatus('❌ ' + err.message, true);
    }
}

document.getElementById('syncer-login-btn').addEventListener('click', loginToKiroku);
document.getElementById('syncer-login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') loginToKiroku(); });
document.getElementById('syncer-logout-btn').addEventListener('click', () => {
    chrome.storage.local.remove(['auth_token', 'auth_user'], () => {
        renderAccount(null);
        showSyncerStatus('Çıkış yapıldı. Anahtarı tamamen iptal etmek için Kiroku → Profil.');
    });
});

async function getAuthHeader() {
    return new Promise((resolve) => {
        chrome.storage.local.get('auth_token', (res) => resolve(res.auth_token ? { Authorization: `Bearer ${res.auth_token}` } : {}));
    });
}

// Sayfa bağlamı tespiti (Aktif tab'a göre buton gösterimi)
async function checkCurrentPageContext() {
    const pageActionDiv = document.getElementById('syncer-page-action');
    const label = document.getElementById('syncer-page-label');
    const btn = document.getElementById('syncer-action-btn');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
            pageActionDiv.style.display = 'none';
            return;
        }

        const url = tab.url;

        // 1. MyAnimeList Sayfası VEYA Anizium Anime Detay Sayfası
        if (url.includes('myanimelist.net/anime/') || (url.includes('anizium.co/anime/') || url.includes('anizium.com/anime/'))) {
            pageActionDiv.style.display = 'block';
            label.textContent = url.includes('myanimelist') ? '📋 MyAnimeList Sayfası' : '📋 Anizium Anime Sayfası';
            btn.textContent = '➕ Bu Animeyi Watchlist\'e Ekle';
            btn.onclick = () => handleAddFromMAL(tab.id);
            return;
        }

        // 2. İzleme Siteleri (Video Oynatılan Bölüm Sayfaları)
        const isStreaming = ['turkanime.co', 'tranimeizle.top', 'anizium.co', 'anizium.com'].some(domain => url.includes(domain));
        if (isStreaming) {
            pageActionDiv.style.display = 'block';
            label.textContent = '📺 İzleme Sitesi Bölüm Algılandı';
            btn.textContent = '💾 İzleme Durumunu Güncelle';
            btn.onclick = () => handleUpdateFromStreaming(tab.id);
            return;
        }

        pageActionDiv.style.display = 'none';
    } catch (err) {
        pageActionDiv.style.display = 'none';
    }
}

// Güvenli JSON Fetch İstemcisi
async function safeFetchJson(url, options = {}) {
    let res;
    try {
        res = await fetch(url, options);
    } catch (networkErr) {
        throw new Error(`Bağlantı kurulamadı (${networkErr.message}). Backend'in açık olduğunu ve Service URL'nin doğru olduğunu kontrol edin.`);
    }

    const text = await res.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch (parseErr) {
        if (text.includes("Client sent an HTTP request to an HTTPS server")) {
            throw new Error("HTTP yerine HTTPS kullanmalısınız! Lütfen Service URL'yi 'https://...' olarak güncelleyin.");
        }
        if (text.includes("<!DOCTYPE") || text.includes("<html")) {
            throw new Error(`Sunucu (${res.status}) HTML sayfası döndürdü. Service URL'in port 3000 değil, backend portu (örn: https://localhost:8080) olduğundan emin olun.`);
        }
        if (res.status === 404) {
            throw new Error(`Adres bulunamadı (404 Not Found): ${url}`);
        }
        throw new Error(text || `Sunucu hatası (${res.status})`);
    }

    if (!res.ok) {
        const errorMsg = res.status === 401 && !url.includes('/auth/')
            ? "Kiroku hesabına giriş yapılmamış. Configs sekmesinden giriş yap."
            : data?.error || data?.message || `Hata (${res.status})`;
        throw new Error(errorMsg);
    }

    return data;
}

// MAL veya Anizium sayfasından animeyi doğrudan backend'e ekleme
async function handleAddFromMAL(tabId) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const isMal = tab?.url?.includes("myanimelist.net/anime/");
        
        if (isMal) {
            const rawUrl = await getServiceUrl();
            const serviceUrl = (rawUrl || "https://localhost:8080").trim().replace(/\/+$/, "");
            const response = await chrome.tabs.sendMessage(tabId, { action: "getAnimeInfo" });
            if (!response || !response.animeInfo || !response.animeInfo.Name) {
                return showSyncerStatus('Sayfadan anime bilgisi alınamadı.', true);
            }

            await safeFetchJson(`${serviceUrl}/api/create-anime`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
                body: JSON.stringify(response.animeInfo),
                credentials: "omit",
                mode: "cors"
            });

            showSyncerStatus('✅ Anime Watchlist\'e başarıyla eklendi!');
        } else {
            const response = await chrome.tabs.sendMessage(tabId, { action: "getAnimeTitle" });
            const title = response?.title;
            if (!title) {
                return showSyncerStatus('Sayfadan anime adı okunamadı.', true);
            }

            showSyncerStatus('🔍 AniList\'te aranıyor ve ekleniyor...');
            chrome.runtime.sendMessage({
                action: "addFromTitle",
                title: title,
                pageUrl: tab.url || "",
                currentEpisode: 0
            }, (res) => {
                if (res && res.success) {
                    showSyncerStatus(`✅ Eklendi: ${res.animeName || title}`);
                } else {
                    const isDup = res?.error?.toLowerCase().includes("duplicate") || res?.error?.toLowerCase().includes("zaten");
                    showSyncerStatus(isDup ? '⚠️ Bu anime zaten Watchlist\'te var!' : '❌ ' + (res?.error || "Kayıt başarısız"), true);
                }
            });
        }
    } catch (err) {
        const isDup = err.message?.includes("duplicate") || err.message?.includes("zaten");
        showSyncerStatus(isDup ? '⚠️ Bu anime zaten Watchlist\'te var!' : '❌ ' + err.message, true);
    }
}

// İzleme sitesinden bölüm güncelleme
async function handleUpdateFromStreaming(tabId) {
    const rawUrl = await getServiceUrl();
    const serviceUrl = (rawUrl || "https://localhost:8080").trim().replace(/\/+$/, "");

    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: "getEpisodeInfo" });
        if (!response || !response.episodeInfo || !response.episodeInfo.name) {
            return showSyncerStatus('Bölüm veya anime başlığı bulunamadı.', true);
        }

        await safeFetchJson(`${serviceUrl}/api/anime/update-episode`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
            body: JSON.stringify(response.episodeInfo),
            credentials: "omit",
            mode: "cors"
        });

        const ep = response.episodeInfo.watchStatus;
        showSyncerStatus(`✅ ${response.episodeInfo.name} Bölüm ${ep > 0 ? ep : ''} güncellendi!`);
    } catch (err) {
        showSyncerStatus('❌ ' + err.message, true);
    }
}

document.getElementById('open-manga-downloader').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('manga-downloader.html') });
});

// ============================================================
// Tablodaki puanlanmış animeleri Kiroku'ya aktar
// AniList'ten romaji ad, MAL bağlantısı, bölüm sayısı, türler ve kapak alınır; Kiroku'nun ad eşleştirmesi
// romaji adla çalıştığı için katalogdaki kayıtla buluşur. Puan 10'luktan Kiroku'nun 100'lük ölçeğine çevrilir.
// ============================================================

async function importRatedToKiroku() {
    const statusEl = document.getElementById('import-rated-status');
    const btn = document.getElementById('btn-import-rated');
    const show = (text, isError = false) => {
        statusEl.style.display = 'block';
        statusEl.textContent = text;
        statusEl.style.color = isError ? 'var(--danger)' : 'var(--text)';
    };
    const serviceUrl = (await getServiceUrl()).trim().replace(/\/+$/, '');
    if (!serviceUrl) return show('Önce Ayarlar sekmesinden Service URL gir.', true);
    const auth = await getAuthHeader();
    if (!auth.Authorization) return show('Önce Ayarlar sekmesinden Kiroku hesabına giriş yap.', true);

    // Aynı AniList kaydının sezonları tek satır: en yüksek puan ve bitirildi bilgisi korunur
    const byId = new Map();
    for (const [key, entry] of Object.entries(animeHistory)) {
        const score = parseFloat(entry.score);
        if (!(score > 0)) continue;
        const id = parseInt(String(key).split('_')[0]);
        if (!id) continue;
        const prev = byId.get(id);
        if (!prev || score > prev.score) byId.set(id, { score, completed: entry.status === 'completed' || (prev && prev.completed) });
    }
    if (!byId.size) return show('Tabloda puanlanmış anime yok.');

    btn.disabled = true;
    try {
        show(`${byId.size} anime için AniList bilgisi alınıyor…`);
        const ids = [...byId.keys()];
        const media = [];
        for (let i = 0; i < ids.length; i += 50) {
            const res = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    query: `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id idMal title { romaji english } episodes format status genres coverImage { extraLarge large } } } }`,
                    variables: { ids: ids.slice(i, i + 50) },
                }),
            });
            if (!res.ok) throw new Error(`AniList ${res.status}`);
            media.push(...((await res.json()).data?.Page?.media || []));
        }

        const statusMap = { FINISHED: 'Finished', RELEASING: 'Currently Airing', NOT_YET_RELEASED: 'Not yet aired', CANCELLED: 'Finished', HIATUS: 'Currently Airing' };
        let done = 0, failed = 0;
        for (const m of media) {
            const own = byId.get(m.id);
            try {
                await safeFetchJson(`${serviceUrl}/api/create-anime`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...auth },
                    body: JSON.stringify({
                        Name: m.title.romaji || m.title.english,
                        EnglishName: m.title.english || '',
                        AnimeStatus: statusMap[m.status] || 'Unknown',
                        TotalNumberOfEpisodes: m.episodes || 0,
                        IsMovie: m.format === 'MOVIE',
                        Genre: (m.genres || []).join(', '),
                        Cover: m.coverImage?.extraLarge || m.coverImage?.large || '',
                        MALAnimeLink: m.idMal ? `https://myanimelist.net/anime/${m.idMal}` : '',
                        Score: Math.round(own.score * 10),
                        // Bitirildiyse tüm bölümler izlenmiş sayılır
                        WatchStatus: own.completed && m.episodes ? m.episodes : 0,
                    }),
                });
                done++;
            } catch (e) {
                failed++;
            }
            show(`Aktarılıyor… ${done + failed}/${media.length}`);
        }
        show(`Bitti: ${done} anime Kiroku'ya aktarıldı${failed ? `, ${failed} anime aktarılamadı` : ''}.`, failed > 0 && done === 0);
    } catch (e) {
        show(`Aktarılamadı: ${e.message}`, true);
    } finally {
        btn.disabled = false;
    }
}

document.getElementById('btn-import-rated').addEventListener('click', importRatedToKiroku);

// Dijital manga okuma siteleri (manga-reading.js bu listedeki sitelerde çalışır)
const DEFAULT_MANGA_SITES = ['ravenscans.org', 'ravenscans.com', 'mangadex.org', 'mgeko.cc', 'mangaplus.shueisha.co.jp'];
chrome.storage.local.get('manga_sites', (s) => {
    const sites = Array.isArray(s.manga_sites) && s.manga_sites.length ? s.manga_sites : DEFAULT_MANGA_SITES;
    document.getElementById('manga-sites').value = sites.join('\n');
});
document.getElementById('manga-sites-save').addEventListener('click', () => {
    const sites = document.getElementById('manga-sites').value
        .split(/\s+/)
        .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase())
        .filter(Boolean);
    chrome.storage.local.set({ manga_sites: [...new Set(sites)] }, () => showSyncerStatus('Manga siteleri kaydedildi. Açık sekmeleri yenile.'));
});

