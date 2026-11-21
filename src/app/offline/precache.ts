/**
 * Status precache yang ditulis service worker dan dibaca halaman.
 *
 * SW tidak bisa memakai localStorage; statusnya disimpan sebagai response JSON di cache khusus
 * `pc-precache-status`. Nama ini sengaja tidak memakai awalan `paranoidclick-` supaya tidak ikut
 * dihapus oleh pembersihan cache versi lama.
 */

export const CACHE_STATUS = 'pc-precache-status';
export const KUNCI_STATUS = '/__precache_status__';

export interface PrecacheFailure {
  url: string;
  message: string;
}

export interface PrecacheStatus {
  total: number;
  gagal: PrecacheFailure[];
  at: number;
}

/**
 * Validasi status dari SW/cache. Status rusak atau dari build lain diperlakukan sebagai tidak ada;
 * jangan menampilkan peringatan dari data yang tidak bisa dijelaskan bentuknya.
 */
export function parseStatusPrecache(nilai: unknown): PrecacheStatus | null {
  if (typeof nilai !== 'object' || nilai === null) return null;
  const v = nilai as Record<string, unknown>;
  if (typeof v.total !== 'number' || !Number.isInteger(v.total) || v.total < 0) return null;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
  if (!Array.isArray(v.gagal)) return null;

  const gagal: PrecacheFailure[] = [];
  for (const item of v.gagal) {
    if (typeof item !== 'object' || item === null) return null;
    const f = item as Record<string, unknown>;
    if (typeof f.url !== 'string' || f.url.length === 0 || typeof f.message !== 'string') return null;
    gagal.push({ url: f.url, message: f.message });
  }
  if (v.total < gagal.length) return null;
  return { total: v.total, gagal, at: v.at };
}

/** Teks yang cukup untuk memberi tahu kegagalan tanpa membuka DevTools. */
export function ringkasGagalPrecache(status: PrecacheStatus): string {
  if (status.gagal.length === 0) return '';
  const daftar = status.gagal.map((f) => f.url).join(', ');
  return `Precache tidak lengkap: ${status.gagal.length}/${status.total} aset gagal (${daftar}). Aplikasi mungkin tidak bisa dibuka offline.`;
}

/** Baca status yang sudah dipersistenkan SW, termasuk kegagalan install yang tidak pernah aktif. */
export async function bacaStatusDariCache(): Promise<PrecacheStatus | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_STATUS);
    const res = await cache.match(KUNCI_STATUS);
    return res ? parseStatusPrecache(await res.json()) : null;
  } catch {
    return null;
  }
}
