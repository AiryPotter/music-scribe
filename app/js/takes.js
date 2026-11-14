// Saved takes library: every finished take is kept on this device (IndexedDB).
// Only the written music is stored (notes, edits, title, tuning). Never any audio.

const DB = 'music-scribe-takes';
const STORE = 'takes';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

export function newTakeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let askedPersist = false;
/** rec = { id, title, createdAt, savedAt, bpm, meter, bars, noteCount, data (project object) } */
export async function saveTake(rec) {
  if (!askedPersist) { askedPersist = true; try { navigator.storage?.persist?.(); } catch { /* optional */ } }
  await tx('readwrite', (s) => s.put(rec));
}
/** Newest first. Returns [] if storage is unavailable (e.g. private browsing). */
export async function listTakes() {
  try {
    const all = (await tx('readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch { return []; }
}
export async function deleteTake(id) {
  await tx('readwrite', (s) => s.delete(id));
}
