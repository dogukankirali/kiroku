import axios from "axios";
import { API_BASE } from "@/Services/http";

// Per-user state that follows the account across devices (player preferences, watch/read positions,
// "continue" lists). localStorage is the fast local copy; the server copy (/api/state) is
// last-write-wins per key. Without a login everything stays local.

type Stored = { v: string; t: number };

const PREFIX = "ks:";
const FLUSH_MS = 800;

const pending = new Map<string, string | null>();
let timer: ReturnType<typeof setTimeout> | undefined;

const loggedIn = () => typeof window !== "undefined" && Boolean(localStorage.getItem("token"));

function readStored(key: string): Stored | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null, t: number) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, t } satisfies Stored));
  } catch {
    /* storage full or blocked: the server copy still works */
  }
}

async function flush() {
  timer = undefined;
  if (!pending.size || !loggedIn()) return;
  const items = [...pending].slice(0, 100).map(([key, value]) => ({ key, value }));
  items.forEach(({ key }) => pending.delete(key));
  try {
    await axios.put(`${API_BASE}/state`, { items });
  } catch {
    // Network or session problem: put the writes back (unless newer ones arrived) and retry later
    for (const { key, value } of items) if (!pending.has(key)) pending.set(key, value);
    timer = setTimeout(flush, 30000);
    return;
  }
  if (pending.size) timer = setTimeout(flush, FLUSH_MS);
}

export function stateGet(key: string): string | null {
  return readStored(key)?.v ?? null;
}

export function stateGetJson<T>(key: string, fallback: T): T {
  const raw = stateGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Saves locally right away and to the server shortly after; null deletes the key. */
export function stateSet(key: string, value: string | null) {
  writeStored(key, value, Date.now());
  if (!loggedIn()) return;
  pending.set(key, value);
  if (timer === undefined) timer = setTimeout(flush, FLUSH_MS);
}

export const stateSetJson = (key: string, value: unknown) => stateSet(key, value === null ? null : JSON.stringify(value));

/** Pulls the server copy of keys starting with `prefix` and keeps whichever side is newer. */
export async function stateSync(prefix = ""): Promise<void> {
  if (!loggedIn()) return;
  try {
    const { data } = await axios.get<{ data: { key: string; value: string; updatedAt: string }[] }>(`${API_BASE}/state`, { params: { prefix } });
    for (const item of data.data) {
      const serverT = Date.parse(item.updatedAt);
      const local = readStored(item.key);
      if (!local || (Number.isFinite(serverT) && serverT > local.t)) writeStored(item.key, item.value, Number.isFinite(serverT) ? serverT : Date.now());
      else if (local.t > serverT && !pending.has(item.key)) pending.set(item.key, local.v); // local is newer (e.g. written offline)
    }
    if (pending.size && timer === undefined) timer = setTimeout(flush, FLUSH_MS);
  } catch {
    /* offline: the local copy is used */
  }
}

/** Local copy of every key starting with `prefix` (call stateSync first to include other devices' writes). */
export function stateList<T>(prefix: string): T[] {
  const out: T[] = [];
  if (typeof window === "undefined") return out;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith(PREFIX + prefix)) continue;
      const stored = readStored(name.slice(PREFIX.length));
      if (stored) out.push(JSON.parse(stored.v) as T);
    }
  } catch {
    /* unreadable entries are skipped */
  }
  return out;
}
