// Yer imi klasöründeki "7.5 / 10 - Başlık" kayıtlarından Kiroku'ya puan aktarır.
// Önce dryRun ile eşleşmeler gösterilir, onaydan sonra yalnızca puanlar yazılır.

const $ = (id) => document.getElementById(id);
const api = typeof browser !== "undefined" ? browser : chrome;

// "7.5 / 10 - Ad", "7,5/10 – Ad", "8 / 10 — Ad" (10 üzerinden)
const TITLE_RE = /^\s*(\d{1,2}(?:[.,]\d+)?)\s*\/\s*10\s*[-–—:]\s*(.+?)\s*$/;

function parseTitle(title) {
    const m = TITLE_RE.exec(title || "");
    if (!m) return null;
    const score = Number(m[1].replace(",", "."));
    return Number.isFinite(score) && score >= 0 && score <= 10 ? { score, title: m[2] } : null;
}

function flatten(nodes, path, out) {
    for (const n of nodes) {
        if (n.url) continue;
        const here = n.title ? [...path, n.title] : path;
        if (n.title) out.push({ id: n.id, label: here.join(" / ") });
        flatten(n.children || [], here, out);
    }
    return out;
}

function bookmarksIn(node, out) {
    for (const c of node.children || []) {
        if (c.url) out.push(c);
        else bookmarksIn(c, out); // alt klasörler de taranır
    }
    return out;
}

const hasPerm = () => new Promise((resolve) => api.permissions.contains({ permissions: ["bookmarks"] }, resolve));
const askPerm = () => new Promise((resolve) => api.permissions.request({ permissions: ["bookmarks"] }, resolve));
const send = (msg) => new Promise((resolve) => api.runtime.sendMessage(msg, resolve));

async function showFolders() {
    const tree = await new Promise((resolve) => api.bookmarks.getTree(resolve));
    const folders = flatten(tree, [], []);
    $("folder").innerHTML = "";
    for (const f of folders) {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.label;
        $("folder").appendChild(opt);
    }
    $("folder-row").hidden = false;
    $("scan-row").hidden = false;
    $("perm-hint").textContent = "Puanların bulunduğu klasörü seç (alt klasörler de taranır).";
    $("grant").hidden = true;
}

let parsed = [];
let matches = [];

function render() {
    const table = $("rows");
    table.innerHTML = "";
    const ok = matches.filter((m) => m.status === "ok").length;
    $("summary").textContent = `${parsed.length} puanlı yer imi okundu: ${ok} eşleşti, ${matches.length - ok} eşleşmedi (adı Kiroku'daki anime adıyla aynı olmalı).`;
    for (const m of matches) {
        const tr = document.createElement("tr");
        tr.style.opacity = m.status === "ok" ? "1" : "0.55";
        for (const text of [m.score.toString(), m.title, m.status === "ok" ? `→ ${m.name}` : "bulunamadı"]) {
            const td = document.createElement("td");
            td.style.padding = "4px 8px";
            td.textContent = text;
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    $("apply").disabled = ok === 0;
    $("result").hidden = false;
}

$("grant").addEventListener("click", async () => {
    if (await askPerm()) await showFolders();
    else $("perm-hint").textContent = "Yer imi izni verilmedi. Verilmezse klasör okunamaz.";
});

$("scan").addEventListener("click", async () => {
    $("done").textContent = "";
    const node = await new Promise((resolve) => api.bookmarks.getSubTree($("folder").value, (r) => resolve(r?.[0])));
    parsed = bookmarksIn(node || {}, []).map((b) => parseTitle(b.title)).filter(Boolean);
    if (!parsed.length) {
        $("summary").textContent = 'Bu klasörde "7.5 / 10 - Ad" biçiminde yer imi bulunamadı.';
        $("rows").innerHTML = "";
        $("apply").disabled = true;
        $("result").hidden = false;
        return;
    }
    $("summary").textContent = "Eşleştiriliyor…";
    const res = await send({ action: "importAnimeScores", items: parsed.slice(0, 300), dryRun: true });
    if (!res?.success) {
        $("result").hidden = false;
        $("summary").textContent = `Hata: ${res?.error || "yanıt yok"}`;
        $("apply").disabled = true;
        return;
    }
    matches = res.data;
    render();
});

$("apply").addEventListener("click", async () => {
    $("apply").disabled = true;
    const items = matches.filter((m) => m.status === "ok").map((m) => ({ title: m.title, score: m.score }));
    const res = await send({ action: "importAnimeScores", items, dryRun: false });
    $("done").textContent = res?.success ? `${res.data.filter((r) => r.status === "ok").length} animenin puanı yazıldı.` : `Hata: ${res?.error || "yanıt yok"}`;
});

hasPerm().then((yes) => yes && showFolders());
