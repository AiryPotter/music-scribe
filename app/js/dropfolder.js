// PC (Chrome / Edge): save straight into the Dropbox folder the desktop app syncs
// (e.g. C:\Users\you\Dropbox). You pick the folder once; Music Scribe remembers it.
// Uses the browser's File System Access API, which phones don't have (they use dropbox.js).

const DB = 'music-scribe';
const STORE = 'handles';
const KEY = 'dropboxFolder';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** True on desktop Chrome/Edge (Android Chrome and iPhone Safari don't support it). */
export const folderSupported = () => typeof window.showDirectoryPicker === 'function';

let folder = null;

/** Load the remembered folder (call when the export sheet opens). */
export async function loadFolder() {
  if (!folderSupported()) return null;
  try { folder = (await idbDo('readonly', (s) => s.get(KEY))) || null; } catch { folder = null; }
  return folder;
}
export const folderName = () => folder?.name || '';

/**
 * Get a folder we're allowed to write to. Must be called straight from a tap/click
 * (the browser only shows the picker or permission prompt in response to one).
 */
export async function ensureFolder({ pickNew = false } = {}) {
  if (!folder || pickNew) {
    folder = await window.showDirectoryPicker({ id: 'music-scribe-dropbox', mode: 'readwrite', startIn: 'documents' });
    try { await idbDo('readwrite', (s) => s.put(folder, KEY)); } catch { /* remembered for this visit only */ }
    return folder;
  }
  let p = await folder.queryPermission({ mode: 'readwrite' });
  if (p !== 'granted') p = await folder.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') throw new Error('Music Scribe needs your OK to save into that folder.');
  return folder;
}

export async function forgetFolder() {
  folder = null;
  try { await idbDo('readwrite', (s) => s.delete(KEY)); } catch { /* ignore */ }
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

/** Write the file into the folder without overwriting anything ("Song (2).pdf"). Returns the name used. */
export async function saveToFolder(dir, name, blob) {
  const m = /^(.*?)((?:\.musicscribe)?\.[^.]+)$/.exec(name);
  const base = m ? m[1] : name, ext = m ? m[2] : '';
  let candidate = name;
  for (let n = 2; await exists(dir, candidate); n++) candidate = `${base} (${n})${ext}`;
  const fh = await dir.getFileHandle(candidate, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return candidate;
}
