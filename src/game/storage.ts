/** Emplacements de sauvegarde dans IndexedDB (avec repli en mémoire si le navigateur refuse). */

export interface SaveMeta {
  slot: string;
  city: string;
  population: number;
  money: number;
  date: string;
  savedAt: number;
}

const DB = 'neoville';
const STORE = 'saves';
const memory = new Map<string, { meta: SaveMeta; data: string }>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function writeSave(meta: SaveMeta, data: string): Promise<void> {
  try { await tx('readwrite', (s) => s.put({ meta, data }, meta.slot)); } catch { memory.set(meta.slot, { meta, data }); }
}

export async function readSave(slot: string): Promise<string | null> {
  try {
    const r = await tx<{ meta: SaveMeta; data: string } | undefined>('readonly', (s) => s.get(slot));
    if (r) return r.data;
  } catch { /* repli mémoire */ }
  return memory.get(slot)?.data ?? null;
}

export async function listSaves(): Promise<SaveMeta[]> {
  let list: SaveMeta[] = [];
  try {
    const all = await tx<Array<{ meta: SaveMeta }>>('readonly', (s) => s.getAll());
    list = all.map((r) => r.meta);
  } catch { list = [...memory.values()].map((r) => r.meta); }
  return list.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSave(slot: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(slot)); } catch { /* ignore */ }
  memory.delete(slot);
}

/** Action à exécuter au prochain démarrage (après rechargement de la page). */
export type Boot = { type: 'new'; config: import('./config').GameConfig } | { type: 'load'; slot: string } | { type: 'data'; data: string };

export function setBoot(b: Boot): boolean {
  try { sessionStorage.setItem('neoville-boot', JSON.stringify(b)); return true; } catch { return false; }
}

export function takeBoot(): Boot | null {
  try {
    const v = sessionStorage.getItem('neoville-boot');
    sessionStorage.removeItem('neoville-boot');
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
