import { parseBpm } from './tempo';

/**
 * Batas dari rencana M3b §0 M5: 20 lagu. Angka ini dipakai di dua tempat yang harus sepakat —
 * server menolak lagu ke-21, dan layar mematikan tombol tambah pada angka yang sama. Kalau
 * keduanya menulis angkanya sendiri-sendiri, satu di antaranya pasti ketinggalan.
 */
export const MAX_SETLIST = 20;
/** Judul dipotong di 40 karakter: muat di satu baris HP dan jauh di bawah MAX_STRING_LEN. */
export const MAX_JUDUL = 40;

export interface Song {
  id: number;
  judul: string;
  bpm: number;
}

/** Judul dipangkas di kedua ujung; kosong, kepanjangan, atau bukan string = null. */
export function parseJudul(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const judul = value.trim();
  return judul.length > 0 && judul.length <= MAX_JUDUL ? judul : null;
}

/** `id` baris SQLite: bilangan bulat positif. 0, negatif, dan pecahan bukan id yang pernah lahir. */
export function parseSongId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** Satu lagu dari frame `state`; null kalau bentuknya tidak bisa dipercaya. */
export function parseSong(value: unknown): Song | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const id = parseSongId(v.id);
  const judul = parseJudul(v.judul);
  const bpm = parseBpm(v.bpm);
  return id === null || judul === null || bpm === null ? null : { id, judul, bpm };
}

/**
 * Daftar lagu dari server. Entri cacat dibuang, bukan mematikan seluruh daftar — alasan yang
 * sama dengan `members` yang dibaca sebelum gerbang grid: satu lagu rusak tidak boleh membuat
 * sebelas HP kehilangan setlist yang benar-benar dikirim. Frame tanpa `setlist` (server lama)
 * menghasilkan null, dan layar mempertahankan daftar yang sudah ada.
 */
export function parseSetlist(value: unknown): Song[] | null {
  if (!Array.isArray(value)) return null;
  const out: Song[] = [];
  for (const item of value) {
    const song = parseSong(item);
    if (song) out.push(song);
    if (out.length === MAX_SETLIST) break;
  }
  return out;
}
