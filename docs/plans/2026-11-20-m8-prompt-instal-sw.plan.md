# M8 irisan 5 — prompt instal & penundaan aktivasi SW

**Tanggal**: 20 November 2026
**Status**: bagian yang tidak butuh jawaban sudah dikerjakan. Keputusan D1–D3 **DIJAWAB 21 Nov 2026** (pakai usulan sementara): D1 tetap menunggu tap, D2 semua HP, D3 auto sekali (30 hari).

## 1. Masalah

SW baru sudah menunggu (`skipWaiting` tidak dipanggil di `install`), tapi `PwaBanner` menawarkan
"Muat ulang" kapan saja — termasuk saat lagu sedang berjalan. Satu klik (atau satu gerakan reflex
menutup notifikasi) memindahkan versi di tengah lagu. Di iOS, `beforeinstallprompt` tidak pernah
ada, jadi sampai sekarang tidak ada satu pun petunjuk pemasangan.

## 2. Keputusan yang perlu dijawab

| # | Pertanyaan | Usulan (dipakai sementara) | Kenapa perlu keputusan |
|---|---|---|---|
| D1 | Saat lagu berhenti, versi baru **otomatis** dimuat, atau tetap menunggu tap "Muat ulang"? | **Tetap menunggu tap.** Implementasi sekarang: tombol baru muncul saat `running=false` | Auto-reload setelah Stop bisa menghapus layar tepat ketika operator mau bicara; tapi kalau dibiarkan, HP bisa tertinggal versi berhari-hari |
| D2 | Penundaan berlaku untuk **semua HP** atau hanya pemimpin? | **Semua HP** (tanda `sesiBerjalan` global per tab) | Pengikut ikut kehilangan klik kalau reload di tengah lagu; tapi kalau hanya pemimpin, pengikut bisa pindah versi duluan dan campur build |
| D3 | Petunjuk iOS muncul **otomatis sekali** (30 hari) atau hanya lewat tombol "Pasang"? | **Otomatis sekali**, tombol "Mengerti" menunda 30 hari | Otomatis membantu yang tidak tahu; tapi di layar kecil ia memakan ruang sebelum sesi dimulai |

## 3. Yang diimplementasikan (tidak bergantung jawaban)

| # | Perilaku |
|---|---|
| I1 | `src/app/offline/sesi.ts`: penanda "lagu berjalan" + langganan; `ClickRoom` menyalakannya dari `ses.running`, mematikannya saat layar dilepas |
| I2 | `PwaBanner`: selama `sesiBerjalan` → teks "dimuat sesudah lagu berhenti, tidak di tengah lagu" dan **tombol "Muat ulang" tidak dirender**; aktivasi tetap hanya lewat pesan `SKIP_WAITING` |
| I3 | Petunjuk iOS: `perluPetunjukIos` (iPhone/iPad, termasuk iPadOS yang mengaku Macintosh + sentuhan > 1), tidak tampil saat standalone; teks "Bagikan → Tambahkan ke Layar Utama"; "Mengerti" memakai penundaan 30 hari yang sama dengan tawaran Android |
| I4 | Tidak ada auto-reload dan tidak ada `skipWaiting` baru; build lama tetap melayani sampai pengguna meminta |

## 4. Yang sengaja belum

Tombol "Pasang" manual di halaman depan untuk iOS (butuh keputusan D3), pengingat versi baru yang
muncul lagi setelah ditutup, dan paksaan reload saat semua tab ditutup (perilaku browser, bukan app).

## 5. Bukti yang harus ada

| # | Bukti | Cara |
|---|---|---|
| S1 | `npm run check` EXIT=0 (tes `sesi` + `perluPetunjukIos`) | gerbang biasa |
| S2 | Saat lagu jalan dan SW baru menunggu: banner menyebut penundaan, tombol Muat ulang tidak ada | sesi nyata + build baru |
| S3 | Setelah Stop: tombol Muat ulang muncul | sesi yang sama |
| S4 | Petunjuk iOS tidak muncul di UA desktop | tes unit `perluPetunjukIos` (browser bukti bukan iOS) |

## 6. Hasil

| # | Hasil | Bukti |
|---|---|---|
| S1 | **LULUS** | `npm run check` EXIT=0 (143 unit / 17 berkas, 39 worker); `npm run build` EXIT=0 |
| S2 | **LULUS** | sesi `7LCV` jalan: banner berbunyi `Versi baru sudah siap — dimuat sesudah lagu berhenti, tidak di tengah lagu.` dan daftar tombol hanya `Nanti` (tidak ada `Muat ulang`) |
| S3 | **LULUS** | pemimpin menekan Stop → banner pengikut kembali `Versi baru sudah siap. Muat ulang…` dengan tombol `Muat ulang` |
| S4 | **LULUS di tingkat unit** | `perluPetunjukIos`: iPhone → true, iPadOS (Macintosh + sentuhan) → true, Mac tanpa sentuhan / Android → false, standalone → false |

Setelah `Muat ulang` diklik: `waiting=false` (aktivasi berjalan) dan cache versi lama masih ada karena
dua tab masih terbuka — retensi yang memang dirancang, bukan kegagalan.

Batas bukti: browser bukti bukan iOS, jadi tampilan petunjuk iOS hanya diuji sebagai fungsi murni,
bukan di layar. Keputusan D1–D3 masih memakai usulan sementara sampai dijawab.
