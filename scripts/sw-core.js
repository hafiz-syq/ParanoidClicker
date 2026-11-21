// SATU definisi aturan "cache mana yang boleh dihapus".
//
// Berkas ini punya dua konsumen yang harus berperilaku identik:
//  - `scripts/sw-core.spec.ts` mengimpornya lewat `npm run test` (dan karena itu `npm run check`);
//  - `scripts/build-sw.ts` menyuntikkan isinya apa adanya ke `dist/sw.js` (kata `export` dibuang,
//    karena service worker klasik tidak boleh punya export). Jadi fungsi yang diuji unit adalah
//    fungsi yang benar-benar dijalankan SW, bukan salinannya.
//
// Aturan: cache versi lain boleh dihapus hanya bila `bolehHapus`. Pemanggil memutuskan itu dari
// jumlah tab — tab yang sudah terbuka masih memegang nama chunk ber-hash dari build lamanya
// (`jsQR-*.js` baru diimpor saat kamera dibuka), jadi menghapus lebih awal berarti impor dinamis
// itu 404 sampai reload. Cache dengan awalan lain tidak pernah disentuh.
export function cacheYangBolehDihapus(semua, { aktif, awalan, bolehHapus }) {
  if (!bolehHapus) return [];
  return semua.filter((nama) => nama.startsWith(awalan) && nama !== aktif);
}

// Hanya SW yang masih memegang registration yang boleh membersihkan. `installing`/`waiting`
// menahan pembersihan sampai versi baru benar-benar aktif; identitas `self.serviceWorker` mencegah
// SW lama yang sudah digantikan menghapus cache SW penerusnya. Argumen dibuat eksplisit supaya
// perilaku ini diuji tanpa browser.
export function bolehBersihkanCache(registration, pekerja) {
  return Boolean(
    pekerja && registration && !registration.installing && !registration.waiting && registration.active === pekerja,
  );
}

/** Tipe respons yang diharapkan; juga dipakai gerbang cek-precache.mjs. */
export function tipeCocok(url, contentType) {
  const ct = contentType ?? '';
  if (url === '/' || url.endsWith('/')) return /text\/html/i.test(ct);
  if (/\.m?js$/i.test(url)) return /(javascript|ecmascript)/i.test(ct);
  if (/\.css$/i.test(url)) return /text\/css/i.test(ct);
  if (/\.webmanifest$/i.test(url)) return /(application\/manifest\+json|application\/json)/i.test(ct);
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(url)) return /^image\//i.test(ct);
  // URL lain tidak boleh disajikan sebagai HTML fallback.
  return !/text\/html/i.test(ct);
}

// Mencoba precache satu per satu supaya kegagalan punya alamat, bukan hanya "addAll gagal".
// Semua URL tetap dicoba; pemanggil yang memutuskan apakah kegagalan membatalkan install.
// `ambil` bisa diganti di tes; default fetch browser.
export async function precacheAset(cache, aset, ambil = fetch) {
  const gagal = [];
  for (const url of aset) {
    try {
      const res = await ambil(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tipe = res.headers.get('content-type') ?? '';
      if (!tipeCocok(url, tipe)) throw new Error(`content-type ${tipe || '(kosong)'}`);
      await cache.put(url, res);
    } catch (e) {
      gagal.push({ url, message: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  return gagal;
}

// Bentuk status yang ditulis SW dan dibaca halaman; satu tempat untuk logika yang diuji.
export function statusPrecache(total, gagal, sekarang) {
  return { total, gagal, at: sekarang };
}
