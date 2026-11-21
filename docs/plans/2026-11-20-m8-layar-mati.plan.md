# M8 irisan 3 — layar mati / tab di-throttle

**Tanggal**: 20 November 2026
**Status**: **IRISAN 3 DIKERJAKAN**. Bukti di §5.

## 1. Masalah

`holdScreen()` baru dipanggil di dalam `openSession`, sesudah `await unlock()` — di iOS gestur sudah
hilang di titik itu, dan wake lock bisa ditolak. Sesudah ditolak, layar diam-diam boleh tidur: klik
berhenti tanpa satu pun peringatan. `visibilitychange` hanya menyegarkan θ, tidak memberi tahu bahwa
tab sempat disembunyikan.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| L1 | Wake lock diminta **di baris pertama handler tombol**, sebelum `await` apa pun | Hanya gestur pertama yang dijamin masih berlaku; `unlock()` pun butuh gestur |
| L2 | Ditolak / tidak ada API → nyalakan **audio senyap** (osilator 40 Hz, gain 0,0001) selama layar sesi hidup | Peramban tidak men-throttle tab yang memutar audio; ini cadangan untuk tab latar, bukan pengganti layar tetap menyala |
| L3 | Pesan diagnostik menyebut mana yang dipakai: `layar ditahan (screen)` atau `gagal … — cadangan: audio senyap` | Operator harus bisa membedakan "aman" dari "cadangan" |
| L4 | `visibilitychange` → hidden saat klik jalan: catat waktu + `missed`; visible: tampilkan peringatan berisi lama disembunyikan, jumlah klik hilang, dan `ctx` | Berhenti diam-diam dilarang; angka hilang sudah ada, tinggal diucapkan |
| L5 | Peringatan tetap di layar sesudah kembali (tidak hilang sendiri) sampai ada perubahan status lain | Kalau hilang sendiri, personil yang baru melihat layar tidak tahu ada lubang |
| L6 | Audio senyap dimatikan saat wake lock berhasil dan saat layar sesi dilepas | Cadangan hanya hidup selama dibutuhkan |

## 3. Berkas

- `src/app/audio/click.ts` — `setKeepAlive(on)`.
- `src/screens/ClickRoom.tsx` — wake lock di gestur pertama, fallback, peringatan visibility.
- `src/index.css` — kelas `.warn` bila belum ada.

## 4. Yang sengaja belum

Video `<video>` loop sebagai cadangan kedua, retry wake lock berkala selain saat visible, dan
deteksi layar mati native (tidak ada API-nya di web).

## 5. Bukti yang harus ada

| # | Bukti | Cara |
|---|---|---|
| S1 | `npm run check` EXIT=0 | gerbang biasa |
| S2 | Wake lock ditolak → diagnostik menyebut cadangan audio senyap, ctx tetap `running` | tab nyata |
| S3 | Simulasi hidden → visible: peringatan berisi lama + klik hilang + ctx | dispatch `visibilitychange` |
| S4 | Klik tetap bertambah sesudah kembali | dua cuplikan `klik … berbunyi` |

## 6. Hasil

| # | Hasil | Bukti |
|---|---|---|
| S1 | **LULUS** | `npm run check` EXIT=0 (140 unit / 39 worker), `npm run typecheck` EXIT=0 |
| S2 | **LULUS** | pengikut: `layar: gagal: NotAllowedError: Wake Lock permission request denied — cadangan: audio senyap…`, `ctx=running`, klik 11 |
| S3 | **LULUS (simulasi event)** | `kembali dari latar setelah 3 dtk — 0 klik hilang selama layar mati, ctx=running.` |
| S4 | **LULUS** | klik 11 → 27 sesudah simulasi, `0 hilang`, θ 0,5 ms |

Batas bukti: tab yang dikendalikan alat ini selalu dilaporkan *not visible*, jadi jalur sukses
`layar ditahan (screen)` tidak pernah tercapai di sini — yang terbukti hanya jalur cadangan.
Simulasi hidden memakai `visibilitychange` yang benar-benar didengar aplikasi, bukan OS yang
membekukan jam audio; angka `0 hilang` karena itu tidak membuktikan pembekuan nyata.
