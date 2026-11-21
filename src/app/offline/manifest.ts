/**
 * M7 — daftar aset dan versi cache untuk service worker.
 *
 * Semua fungsi di sini murni: masukannya HTML hasil build, keluarannya daftar URL serta satu versi
 * pendek. Tidak ada `caches`, `fetch`, atau DOM — bagian itu hidup di
 * `scripts/sw-template.js` dan tidak bisa diuji tanpa browser.
 */

/** Awalan cache milik aplikasi ini; pembersihan hanya menyentuh cache dengan awalan ini. */
export const CACHE_PREFIX = 'paranoidclick-';

/** Shell yang disajikan saat navigasi gagal. */
const SHELL = '/';

export function namaCache(versi: string): string {
  return `${CACHE_PREFIX}${versi}`;
}

/** Aset ber-hash yang dirujuk `index.html` (`/assets/index-*.js`, `/assets/index-*.css`). */
export function asetDariHtml(html: string): string[] {
  const aset: string[] = [];
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    const url = m[1];
    if (url && !aset.includes(url)) aset.push(url);
  }
  return aset;
}

/**
 * Isi cache: shell dan aset yang dirujuk `index.html`. Berkas `public/` (ikon/manifest) sengaja
 * tidak ikut: semuanya tidak diperlukan untuk merender shell, dan satu ikon yang gagal tidak boleh
 * membuat install gagal. Yang tersisa justru daftar wajib—kalau salah satunya gagal, install harus
 * gagal, bukan menyisakan shell tanpa JS/CSS.
 */
export function daftarCache(html: string): string[] {
  return [SHELL, ...asetDariHtml(html)];
}

/** FNV-1a 32-bit: cukup untuk membedakan build, tanpa dependensi dan tanpa `crypto`. */
function fnv1a(teks: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Versi cache = hash dari HTML, daftar aset (diurutkan supaya urutan baca berkas tidak
 * mengubah versi), dan sumber template SW. Mengubah salah satunya menghasilkan versi baru,
 * sehingga cache lama tidak lagi dipakai sebagai shell.
 */
export function versiDari(html: string, aset: readonly string[], swSumber: string): string {
  return fnv1a([html, [...aset].sort().join('\n'), swSumber].join('\u0000'));
}
