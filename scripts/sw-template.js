/* Dihasilkan scripts/build-sw.ts menjadi dist/sw.js — jangan disunting di dist. */
const CACHE = '__CACHE__';
const ASET = __ASET__;
const AWALAN = '__AWALAN__';
// Harus sama dengan CACHE_STATUS/KUNCI_STATUS di src/app/offline/precache.ts. Cache status memakai
// nama tanpa awalan cache build supaya tidak ikut dibersihkan oleh hapusCacheLama.
const CACHE_STATUS = 'pc-precache-status';
const KUNCI_STATUS = '/__precache_status__';

/* __ATURAN_CACHE__ */

// Cache versi ini dulu, baru cache versi lain. Untuk nama ber-hash urutannya tidak penting,
// tapi ikon dan manifest tidak ber-hash: kalau `caches.match` dipakai langsung, salinan dari
// cache versi lama yang lebih dulu dibuat bisa menang atas build ini.
function cariDiCache(req) {
  return caches
    .open(CACHE)
    .then((c) => c.match(req, { ignoreSearch: true }))
    .then((r) => r || caches.match(req, { ignoreSearch: true }));
}

// Ambil daftar cache sebelum memeriksa status. Cache versi baru yang lahir sesudah titik ini tidak
// ikut dihapus; pemeriksaan di awal fungsi saja tidak cukup karena versi baru bisa mulai dipasang
// setelah pemeriksaan. `bolehBersihkanCache` menahan pembersihan selama versi baru installing atau
// waiting, dan menolak SW lama yang sudah digantikan oleh SW aktif.
async function hapusCacheLama(bolehHapus) {
  if (!bolehHapus) return;
  const semua = await caches.keys();
  if (!bolehBersihkanCache(self.registration, self.serviceWorker)) return;
  await Promise.all(
    cacheYangBolehDihapus(semua, { aktif: CACHE, awalan: AWALAN, bolehHapus }).map((n) => caches.delete(n)),
  );
}

async function simpanStatus(status) {
  try {
    const cache = await caches.open(CACHE_STATUS);
    await cache.put(
      KUNCI_STATUS,
      new Response(JSON.stringify(status), { headers: { 'content-type': 'application/json' } }),
    );
  } catch {
    // Diagnostik tidak boleh menggagalkan install; pesan ke klien masih dicoba di bawah.
  }
}

async function kabariStatus(status) {
  try {
    const klien = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const c of klien) c.postMessage({ type: 'PRECACHE_STATUS', status });
  } catch {
    // Halaman yang sedang dibuka mungkin sudah pergi; status tetap ada di cache.
  }
}

async function isiPrecache() {
  const cache = await caches.open(CACHE);
  const gagal = await precacheAset(cache, ASET);
  const status = statusPrecache(ASET.length, gagal, Date.now());
  await simpanStatus(status);
  await kabariStatus(status);
  if (gagal.length) {
    throw new Error(`precache gagal: ${gagal.map((f) => f.url).join(', ')}`);
  }
}

// Cache kosong setelah SW aktif berarti shell offline hilang. Periksa semua URL, bukan hanya
// `/`, karena shell tanpa JS/CSS juga tidak bisa dipakai offline. Satu promise dipakai bersama
// supaya aktivasi dan navigasi tidak memulai precache bersamaan.
let pemulihanCache = null;

async function cacheLengkap() {
  try {
    const cache = await caches.open(CACHE);
    // Shell adalah syarat minimum: tanpa '/', semua aset lain tidak bisa merender halaman offline.
    // Periksa ini lebih dulu supaya cache kosong langsung masuk jalur pemulihan, bukan membuka
    // pemeriksaan aset satu per satu. Aset lain tetap wajib, termasuk CSS/JS ber-hash.
    if (!(await cache.match('/'))) return false;
    for (const url of ASET) {
      if (url !== '/' && !(await cache.match(url))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function pastikanCache() {
  if (pemulihanCache) return pemulihanCache;
  pemulihanCache = (async () => {
    if (await cacheLengkap()) return true;
    try {
      await isiPrecache();
    } catch {
      // isiPrecache sudah menulis status kegagalan; cek hasilnya di bawah.
    }
    if (await cacheLengkap()) return true;
    // Jangan biarkan registrasi aktif dengan cache yang tidak bisa dipakai offline.
    // Hapus cache parsial; kunjungan berikutnya akan mendaftarkan SW baru dari awal.
    try {
      await caches.delete(CACHE);
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    return false;
  })().finally(() => {
    pemulihanCache = null;
  });
  return pemulihanCache;
}

self.addEventListener('install', (event) => {
  // Gagal di sini (mis. offline saat update) berarti sw.js ini tidak pernah aktif; service worker
  // versi sebelumnya tetap melayani dan percobaan diulang pada navigasi berikutnya.
  // Tanpa `skipWaiting()`: versi baru MENUNGGU sampai pengguna menekan "Muat ulang" (pesan
  // SKIP_WAITING) atau sampai tidak ada tab yang memakai versi lama. Pindah build saat lagu
  // berjalan harus keputusan manusia, bukan efek samping browser.
  //
  // Semua URL di ASET wajib untuk merender shell: `/` plus aset ber-hash yang dirujuk HTML.
  // Aset dicoba satu per satu supaya status bisa menyebut URL yang gagal; setelah semua dicoba,
  // kegagalan apa pun tetap menolak install (SW lama tetap aktif). Ini sengaja: install yang
  // "berhasil" dengan shell tanpa JS/CSS hanya memindahkan kegagalan ke saat offline. Status
  // ditulis sebelum throw supaya kegagalan install tetap bisa dibaca halaman.
  event.waitUntil(isiPrecache());
});

self.addEventListener('message', (event) => {
  // Banner build bertanya ke SW yang sedang mengontrol halaman. Balas dengan CACHE versi ini,
  // bukan versi yang sedang menunggu; CACHE tidak memengaruhi install/activate/fetch.
  if (event.data?.type === 'SW_VERSION') {
    event.source?.postMessage({ type: 'SW_VERSION', version: CACHE });
    return;
  }
  if (event.data?.type !== 'SKIP_WAITING') return;
  // `waitUntil` menahan SW tetap hidup sampai aktivasi selesai; tanpa itu browser boleh
  // mematikan worker tepat setelah pesan diterima.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Jangan aktif dengan cache yang kosong/parsial. Kalau cache versi ini hilang, coba isi ulang;
  // kalau tetap gagal, lepaskan registrasi supaya kunjungan berikutnya bersih.
  event.waitUntil(
    (async () => {
      await pastikanCache();
      try {
        await self.clients.claim();
      } catch {
        // Registrasi bisa sudah dilepas oleh pastikanCache.
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Jalur data: biarkan gagal terlihat. Cache di sini akan menyamarkan worker mati.
  if (url.pathname === '/ws' || url.pathname === '/create' || url.pathname === '/health') return;

  if (req.mode === 'navigate') {
    // Network-first: online selalu HTML terbaru; offline jatuh ke shell versi ini. Kunci cache
    // selalu '/', sedangkan URL boleh ber-query (`?sid=…&tok=…`); query dibaca ulang oleh app.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const salinan = res.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put('/', salinan))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match('/')).then((r) => r || Response.error())),
    );
    // Pemeriksaan ini juga berjalan pada reload ketika SW sudah aktif; tanpa itu, cache yang
    // dikosongkan dari luar hanya akan terlihat saat offline sudah gagal.
    event.waitUntil(pastikanCache().catch(() => {}));
    // Cache lama ditahan selama masih ada tab lain: hanya setelah navigasi selesai dan tinggal
    // ≤1 tab (halaman yang baru memuat build ini) penghapusan boleh dipertimbangkan.
    event.waitUntil(
      self.clients
        .matchAll({ includeUncontrolled: true, type: 'window' })
        .then((klien) => hapusCacheLama(klien.length <= 1))
        .catch(() => {}),
    );
    return;
  }

  // Selain navigasi: cache-first. Ini yang menyajikan chunk ber-hash lama ke tab yang belum
  // reload; `/assets/` tidak perlu dicocokkan dengan daftar versi ini karena `cariDiCache`
  // sudah mencari di semua cache sebagai langkah kedua.
  event.respondWith(cariDiCache(req).then((r) => r || fetch(req)));
});
