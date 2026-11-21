# M7 — PWA/offline, irisan 1: app shell dari service worker

**Tanggal**: 20 November 2026
**Status**: **IRISAN 1 DIKERJAKAN** — service worker hasil build + logika versi cache yang diuji
unit. Bukti reload tanpa server dicatat di §5. Yang belum: prompt instal, layar "versi baru
tersedia", dan apa pun soal audio saat offline.

## 1. Masalah

Metronom ini dipakai di panggung dengan Wi-Fi kafe. Kalau jaringan mati di tengah lagu, aplikasi
yang sudah terbuka tetap jalan (semua sinkronisasi lewat WebSocket yang sudah terhubung), tapi
**reload** — disengaja atau karena ponsel membuang tab — akan gagal memuat apa pun: worker mengirim
HTML, aset JS/CSS diambil dari jaringan, dan tidak ada yang tersimpan.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| P1 | Service worker dibuat **saat build** (`scripts/build-sw.ts`), bukan disajikan mentah dari `public/` | Daftar aset harus memuat nama ber-hash (`index-k_GMCr-B.js`); versi cache dihitung dari isinya, jadi deploy baru tidak bisa menyajikan shell lama |
| P2 | Navigasi: **network-first**, jatuh ke cache `/` | Online harus selalu dapat HTML terbaru; offline tetap merender kerangka aplikasi |
| P3 | Semua permintaan non-navigasi: **cache-first**, cache versi ini diperiksa dulu lalu cache versi lain | Nama ber-hash tidak berubah isinya, jadi tidak perlu jaringan; urutan penting untuk ikon/manifest yang tidak ber-hash |
| P4 | `/ws`, `/create`, `/health` **tidak** disentuh service worker | Itu jalur data/WebSocket; cache akan menyembunyikan kegagalan yang justru perlu terlihat |
| P5 | Cache lama **ditahan**; `activate` tidak menghapus apa pun, dan pembersihan hanya terjadi setelah navigasi selesai bila tinggal ≤1 tab | Tab yang sudah terbuka masih memegang nama chunk ber-hash lama (`jsQR-*.js` baru diimpor saat kamera dibuka). Menghapus cache di `activate` membuat impor dinamis itu gagal 404 sampai reload |
| P6 | Registrasi di `src/main.tsx`, kegagalan diabaikan (`catch`) | Dev server Vite tidak menyajikan `/sw.js`; itu bukan alasan aplikasi gagal tampil |
| P7 | Versi = hash FNV-1a dari HTML + daftar aset + sumber template SW | Deterministik, tanpa dependensi, dan berubah bila salah satu masukannya berubah |

Batas yang disadari: offline hanya menjamin **shell** tampil. Membuat sesi baru, join, atau
menyimpan setlist tetap butuh worker; layar akan menampilkan pesan gagal koneksi seperti biasa.

## 3. Berkas

- `src/app/offline/manifest.ts` — murni: `asetDariHtml`, `daftarCache`, `namaCache`, `versiDari`.
- `src/app/offline/manifest.spec.ts` — tes unit untuk keempatnya.
- `scripts/sw-core.js` — satu-satunya definisi `cacheYangBolehDihapus`; diuji `sw-core.spec.ts` dan disuntikkan apa adanya ke `dist/sw.js`.
- `scripts/sw-template.js` — kerangka service worker dengan penanda `__ATURAN_CACHE__`, `__CACHE__`, `__AWALAN__`, `__ASET__`.
- `scripts/build-sw.ts` — membaca `dist/index.html`, menulis `dist/sw.js`.
- `package.json` — `build` menjadi `vite build && tsx scripts/build-sw.ts`.
- `src/main.tsx` — registrasi `/sw.js` setelah `load`.

## 4. Yang sengaja belum

Prompt "Pasang aplikasi", UI "versi baru tersedia, muat ulang?", cache respons API, dan
precache audio hitungan. Semua itu menunggu irisan 2 dan tidak boleh diklaim ada.

## 5. Bukti yang harus ada sebelum disebut hidup

| # | Bukti | Cara |
|---|---|---|
| O1 | `npm run check` EXIT=0, termasuk tes versi/daftar cache | gerbang yang sama dengan M2–M6 |
| O2 | `dist/sw.js` memuat aset ber-hash yang benar-benar ada di `dist/` | baca keluaran build |
| O3 | Reload dengan server mati tetap merender halaman | matikan proses preview, reload tab, periksa teks + `document.title` |
| O4 | Cache lama bertahan selama tab lama terbuka, lalu terhapus setelah tab itu reload/tutup | ganti satu byte sumber, buka tab kedua, periksa `caches.keys()`; lalu tutup tab lain + reload, periksa lagi |
| O5 | Chunk ber-hash lama masih bisa diimpor tab lama setelah versi baru aktif | taruh `/assets/lama-jsqr.js` di cache lama, `import()` dari tab lama, harus 200 |
