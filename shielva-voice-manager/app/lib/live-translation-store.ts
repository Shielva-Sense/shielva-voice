/**
 * IndexedDB store for live-translation clips.
 *
 * Persists across page refreshes on the same machine.
 * Audio is stored as ArrayBuffer so blob URLs can be recreated after refresh.
 * Cloud metadata (cloudUrl, cloudId) is stored to enable cross-device playback.
 */

const DB_NAME    = "shielva-live-translation";
const DB_VERSION = 1;
const STORE_NAME = "clips";

export interface StoredClip {
  id: string;
  langPair: string;
  srcLang: string;
  tgtLang: string;
  transcript: string;
  translation: string;
  timestamp: number;
  audioBuffer: ArrayBuffer;
  cloudUrl?: string;  // R2 URL returned by backend
  cloudId?: string;   // MongoDB _id from processed_items
  localPath?: string; // Gateway-local file path (if saved)
}

// ── DB open ───────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("langPair",  "langPair",  { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveClipIDB(clip: StoredClip): Promise<void> {
  const db   = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(clip);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Load all clips grouped by langPair, newest first. */
export async function loadAllClipsIDB(): Promise<Record<string, StoredClip[]>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => {
      const all: StoredClip[] = req.result ?? [];
      // Sort newest first
      all.sort((a, b) => b.timestamp - a.timestamp);
      const grouped: Record<string, StoredClip[]> = {};
      for (const clip of all) {
        grouped[clip.langPair] = grouped[clip.langPair] ?? [];
        grouped[clip.langPair].push(clip);
      }
      resolve(grouped);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Update cloud metadata for an existing clip (after backend save completes). */
export async function updateClipCloud(
  id: string,
  cloudUrl: string,
  cloudId?: string,
  localPath?: string,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (!getReq.result) { resolve(); return; }
      const updated: StoredClip = { ...getReq.result, cloudUrl, cloudId, localPath };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror   = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteClipIDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Convert a StoredClip's ArrayBuffer back into an object URL.
 * Caller is responsible for revoking via URL.revokeObjectURL() when done.
 */
export function bufferToUrl(buffer: ArrayBuffer): string {
  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}
