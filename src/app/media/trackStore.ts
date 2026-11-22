/**
 * Penyimpanan track lokal (MP3/WAV/OGG) + metadata panggung.
 *
 * Audio disimpan di object store terpisah dari metadata supaya daftar lagu bisa dibaca
 * tanpa memuat puluhan megabyte ArrayBuffer ke memori. Kunci `id` dibuat di layar, bukan
 * auto-increment: track harus tetap bisa dihubungkan ke `song.id` server sesudah reload.
 */
export interface TrackMeta {
  id: string;
  /** `song.id` server; null = belum dihubungkan ke setlist. */
  songId: number | null;
  title: string;
  fileName: string;
  mime: string;
  size: number;
  durationMs: number;
  tuning: string;
  key: string;
  notes: string;
  /** Program Change MIDI 0..127 yang dikirim saat lagu ini dipilih. */
  program: number;
  addedAt: number;
}

export interface TrackRecord extends TrackMeta {
  data: ArrayBuffer;
}

const DB_NAME = 'paranoidclick-tracks';
const DB_VERSION = 1;
const META = 'meta';
const BLOB = 'blob';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    // Mode privat iOS lama bisa tidak punya IndexedDB. Layar tetap hidup; hanya track
    // yang tidak bisa disimpan, dan itu dilaporkan oleh pemanggil.
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BLOB)) db.createObjectStore(BLOB, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

export async function listTracks(): Promise<TrackMeta[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const t = db.transaction(META, 'readonly');
    const req = t.objectStore(META).getAll();
    req.onsuccess = () =>
      resolve((req.result as TrackMeta[]).sort((a, b) => a.addedAt - b.addedAt));
    req.onerror = () => resolve([]);
  });
}

export async function saveTrack(meta: TrackMeta, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  if (!db) throw new Error('IndexedDB tidak tersedia di browser ini');
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([META, BLOB], 'readwrite');
    t.objectStore(META).put(meta);
    t.objectStore(BLOB).put({ id: meta.id, data });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('gagal menyimpan track'));
    t.onabort = () => reject(t.error ?? new Error('penyimpanan track dibatalkan'));
  });
}

export async function updateTrackMeta(id: string, patch: Partial<TrackMeta>): Promise<TrackMeta | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const t = db.transaction(META, 'readwrite');
    const store = t.objectStore(META);
    const get = store.get(id);
    get.onsuccess = () => {
      const lama = get.result as TrackMeta | undefined;
      if (!lama) {
        resolve(null);
        return;
      }
      const baru = { ...lama, ...patch, id: lama.id };
      store.put(baru);
      resolve(baru);
    };
    get.onerror = () => resolve(null);
  });
}

export async function getTrackData(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const t = db.transaction(BLOB, 'readonly');
    const req = t.objectStore(BLOB).get(id);
    req.onsuccess = () => resolve((req.result as { data?: ArrayBuffer } | undefined)?.data ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const t = db.transaction([META, BLOB], 'readwrite');
    t.objectStore(META).delete(id);
    t.objectStore(BLOB).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => resolve();
  });
}

/** Cocokkan track lokal ke lagu server lewat id dulu, lalu judul yang dinormalkan. */
export function trackForSong(tracks: TrackMeta[], songId: number, judul: string): TrackMeta | undefined {
  const byId = tracks.find((t) => t.songId === songId);
  if (byId) return byId;
  const key = judul.trim().toLowerCase();
  return tracks.find((t) => t.title.trim().toLowerCase() === key);
}

/** `m:ss` / `h:mm:ss`; 0 berarti durasi belum diketahui. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
