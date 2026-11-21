# M7 irisan 3 — update SW berkala tanpa menyela lagu

**Tanggal**: 21 November 2026
**Status**: **RENCANA + IMPLEMENTASI**.

## 1. Masalah

SW baru sudah menunggu (`skipWaiting` tidak dipanggil di `install`) dan `PwaBanner` sudah
menahan tombol “Muat ulang” selama lagu berjalan. Tetapi pemeriksaan update hanya terjadi saat
`register()` dipanggil atau saat navigasi. HP yang tabnya dibiarkan terbuka dapat memakai build
lama berjam-jam: build baru tidak pernah ditemukan, atau baru ditemukan saat halaman akhirnya
di-reload.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| U1 | Setelah registrasi berhasil, panggil `registration.update()` secara berkala setiap **15 menit** | Tab yang terbuka lama tetap memeriksa `sw.js` tanpa menunggu navigasi |
| U2 | Pemeriksaan interval hanya saat halaman **terlihat**; saat kembali terlihat, periksa bila sudah ≥60 detik sejak pemeriksaan terakhir; event `online` memaksa satu pemeriksaan | Tidak membangunkan jaringan saat tab latar; HP yang baru bangun tidak menunggu 15 menit lagi |
| U3 | Jangan memanggil `update()` saat registrasi baru selesai; `register()` sendiri sudah melakukan pemeriksaan awal | Menghindari dua fetch `sw.js` beruntun |
| U4 | SW baru tetap **menunggu**; tidak ada `skipWaiting`/reload otomatis | Perpindahan build saat lagu berjalan tetap keputusan manusia |
| U5 | `PwaBanner` tetap menyembunyikan bar “Versi baru” selama `sesiBerjalan` atau `adaLaguBerjalan`; polling 1 detik yang sudah ada dibiarkan | Tombol muat ulang tidak muncul di tengah lagu, tetapi muncul sesudah lagu berhenti |
| U6 | Tidak mengubah `install`, `activate`, `fetch`, cache, atau aturan pembersihan | Irisan ini hanya menambah pemicu pemeriksaan di sisi halaman |

## 3. Berkas

- `src/app/offline/update.ts` — penjadwal kecil dengan dependensi yang bisa diganti untuk tes.
- `src/app/offline/update.spec.ts` — tes interval, throttle saat terlihat, `online`, dan stop.
- `src/main.tsx` — memulai penjadwal setelah `register('/sw.js')` berhasil.
- `src/screens/PwaBanner.tsx` — tidak diubah perilakunya; menjadi jalur yang menampilkan waiting SW
  hanya sesudah lagu berhenti.
- `README.md` — catatan perilaku M7 sesudah bukti.

## 4. Bukti yang harus ada

1. `npm run check` EXIT=0, termasuk tes penjadwal.
2. Browser: build A aktif, build B tersedia tanpa reload halaman; `registration.waiting` terisi.
3. Browser: saat lagu berjalan, bar “Versi baru” tidak dirender; sesudah Stop, bar muncul tanpa
   reload. Tombol “Muat ulang” baru mengirim `SKIP_WAITING` saat itu.
4. Tidak ada perubahan pada perilaku cache selain build baru yang normal.

Batas: pengujian browser memakai update manual untuk mempercepat siklus; interval 15 menit
dibuktikan oleh tes unit dengan jam palsu, bukan dengan menunggu 15 menit di browser. Pengukuran
dua HP fisik dan latensi jaringan tetap di luar irisan ini.
