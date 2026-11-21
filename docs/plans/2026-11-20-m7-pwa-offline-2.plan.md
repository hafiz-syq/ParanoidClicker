# M7 irisan 2 — versi baru tersedia, dan tawaran pasang yang sopan

**Tanggal**: 20 November 2026
**Status**: **IRISAN 2 DIKERJAKAN**. Bukti lokal di §5.

## 1. Masalah

Irisan 1 membuat shell tahan server mati, tapi update build terjadi **tanpa memberi tahu siapa pun**:
`install` memanggil `skipWaiting()`, jadi SW baru langsung mengambil alih halaman yang sedang
dipakai. Dua akibat:

- tidak ada cara memilih "kapan" pindah build; padahal pindah versi di tengah lagu adalah hal yang
  harus diputuskan manusia, bukan browser;
- pengguna tidak punya jalan memasang aplikasi ke home screen, jadi setiap kali harus mengetik URL
  dan tampil dengan address bar.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| Q1 | `skipWaiting()` **dihapus** dari `install`; SW baru menunggu | Hanya dengan begitu ada status "menunggu" yang bisa ditampilkan dan diperintahkan |
| Q2 | Pindah versi lewat pesan `{ type: 'SKIP_WAITING' }` dari tombol "Muat ulang", lalu reload saat `controllerchange` | Aktivasinya eksplisit; reload hanya terjadi kalau pengguna memintanya (`diminta` ref), bukan pada `claim()` pertama |
| Q3 | Pemberitahuan versi bisa ditutup ("Nanti") dan tidak muncul lagi di halaman itu | Menutup bukan berarti setuju; tapi juga bukan alasan untuk mengulanginya tiap render |
| Q4 | Tawaran pasang hanya muncul dari `beforeinstallprompt` (jadi hanya bila browser memang menawarkannya), bisa ditutup, dan setelah ditolak tidak muncul lagi **30 hari** | "Sopan" = tidak menagih; 30 hari cukup lama untuk tidak mengganggu, cukup pendek untuk masih berguna |
| Q5 | Tidak menawarkan pasang saat sudah berjalan `standalone` | Sudah terpasang; tawaran hanya jadi noise |
| Q6 | Aturan "boleh menawarkan" dijadikan fungsi murni `bolehTawarkanPasang` + tes unit | Tanggal kedaluwarsa adalah satu-satunya logika di UI ini yang bisa salah tanpa terlihat |

Batas: ini bukan prompt instal paksa. iOS Safari tidak memicu `beforeinstallprompt`; di sana tidak
ada tawaran sama sekali (instruksi manual "Add to Home Screen" belum dibuat).

## 3. Berkas

- `scripts/sw-template.js` — `install` tanpa `skipWaiting`, ditambah listener `message`.
- `src/app/offline/pasang.ts` + `pasang.spec.ts` — `bolehTawarkanPasang`, `KUNCI_TAWAR`, `TAWAR_ULANG_MS`.
- `src/screens/PwaBanner.tsx` — dua baris: versi baru (Muat ulang / Nanti) dan tawaran pasang (Pasang / Nanti).
- `src/main.tsx` — merender `<PwaBanner />` di samping layar.
- `src/global.css` — `.pwa`, `.pwa-baris`, `.pwa-tutup` memakai warna yang sudah ada.

## 4. Yang sengaja belum

Instruksi pasang manual untuk iOS, penjadwalan update otomatis (mis. "pasang saat jeda lagu"),
dan penanda versi build di layar. Semua menunggu irisan berikutnya.

## 5. Bukti yang harus ada

| # | Bukti | Cara |
|---|---|---|
| P1 | `npm run check` EXIT=0, termasuk tes `bolehTawarkanPasang` | gerbang yang sama |
| P2 | Setelah build berubah dan halaman dimuat ulang, SW baru **menunggu** dan bar "Versi baru sudah siap" muncul | `getRegistration().waiting` + teks banner |
| P3 | Tombol "Muat ulang" memindahkan halaman ke build baru dan cache lama terhapus | klik, lalu `caches.keys()` dan `document.title` |
| P4 | Tawaran pasang muncul dari `beforeinstallprompt`, tombol "Nanti" menutupnya, dan tidak muncul lagi pada percobaan berikutnya | event sintetis + `localStorage` |
