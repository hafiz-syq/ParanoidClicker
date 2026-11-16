# ADR-0002: Ramp tempo dikirim sebagai frame `tempo` biasa, satu langkah per bar

**Tanggal**: 2026-11-15
**Status**: accepted
**Dasar perintah**: kontrak M2 butir 6 (sessi pemeriksa): "Kalau ramp mengubah bpm berangsur, itu
menyentuh `retune()` tiap bar — buktikan dengan test bahwa tidak ada satu pun beat yang terlewat
atau terdobel selama seluruh ramp, di kedua sisi jahitan." `QODER.md:42` melarang test
servo/ramp/kontinuitas dipotong.

## Konteks

Ramp di tengah lagu adalah keputusan terkunci (rencana §kebutuhan), dan mesin jahitnya sudah ada:
pemimpin mengirim `{t:'tempo', bpm}`, `SessionDO.setTempo` memanggil `retune(grid, bpm, Date.now() +
LEAD_MS)` (`SessionDO.ts:171` di `178e1e9`, sekarang `:293` di `a6ea775` — yang tetap adalah nama
fungsinya, `setTempo`; `tempo.ts:54`) sehingga grid baru selalu mulai tepat di batas grid
lama — kedua sisi sepakat tentang *kapan* perpindahan terjadi, tidak ada yang pernah menaruh beat
di masa lalu. Yang belum ada: siapa yang menekan tombol itu 20 kali, dan seberapa sering.

## Keputusan

Ramp adalah **pemimpin** yang mengirim frame `tempo` yang sudah ada, **satu langkah 1 bpm setiap
bar**, dan berhenti sendiri saat target tercapai. Penjadwalnya murni TS di `src/app/sync/ramp.ts`;
satu langkah boleh diminta hanya kalau tiga hal berlaku pada jam server (`ramp.ts:44-53`):

1. beat **server** berikutnya sesudah `serverNow + LEAD_MS` — bukan beat layar berikutnya — adalah
   awal bar (`seamIndex % BEATS_PER_BAR === 0`). Ini yang membuat aksen tidak pernah bergeser, dan
   yang membuat prediksi klien identik dengan `retune` DO detik itu juga.
2. kendor jendela: `seam − (serverNow + LEAD_MS) ≥ periode / 4` (`MIN_SLACK_DIVISOR`, `ramp.ts:13`).
   Tanpa batas ini, permintaan yang lahir tepat di belakang bar bisa mendarat sesudah jahitannya
   sendiri lewat — dan itu lubang bunyi, bukan langkah tempo. Atasnya sengaja tidak ada: makin
   jauh jahitan, makin aman.
3. jahitan itu belum pernah dikirim: dedupe-nya pada **waktu seam**, bukan pada timer
   (`RampState.sentSeamMs`, `ramp.ts:57-65`). Timer yang dibatasi OS sampai 1 detik tetap hanya
   menghasilkan satu langkah per bar.

`shortcut:` dedupe per waktu seam berarti timer kasar bisa **melewatkan** satu bar (25 ms → 1000 ms
tidak lagi menyentuh setiap jendela kendor), jadi ramp di tab yang di-throttle berjalan lebih
lambat, tidak pernah lebih cepat atau dua langkah sekaligus. Tidak ada test yang menuntut 20 langkah
dalam 43,6 detik di bawah timer 1000 ms; yang dituntut adalah "tidak ada dua angka untuk bar yang
sama" (`ramp.spec.ts`, kasus timer 1000 ms).

Peringatan dari gerbang: **aksen tidak boleh dibuktikan lewat `beatIndexAt` ulang.** Pada periode
508,47 ms (118 bpm), `floor((k·P)/P)` = k−1, jadi test yang menurunkan indeks dari waktu lalu
memeriksa `% 4` akan gagal tanpa ada yang bergeser. Yang dituntut test adalah `anchorMs` server ==
jahitan yang dipilih klien lewat indeks bulat.

Tidak ada frame baru, tidak ada kolom baru, tidak ada perubahan kontrak `state` di DO: `proto`
tetap 2 (`index.ts:63`), dan klien versi lama yang sudah ter-install di HP orang tetap memahami
setiap byte yang dikirim ramp. Serah terima grid di sisi klien **berubah** — itu keputusan terpisah
dan ada di ADR-0004.

## Alternatif yang dipertimbangkan

- **Ramp di server dengan `ctx.storage` + alarms** — tolak: wewenang pemimpin baru ditegakkan di
  M3, presisi alarm DO tidak sub-detik, dan ia menaruh kebijakan musik di tempat yang tidak bisa
  di-review orang yang memainkan lagunya.
- **Tiap HP menghitung ramp-nya sendiri lokal** — tolak: melanggar "DO adalah jam, leader adalah
  dirigen"; 12 HP dengan 12 timer menghasilkan 12 grid, dan tidak ada satu pun angka di layar yang
  bisa membuktikan mereka masih sama.
- **Satu langkah per beat** — tolak: 4× lebih banyak jahitan per detik, dan tiap jahitan adalah
  kesempatan antrean 120 ms menelan sebuah beat (`beatIndexAt` di `tempo.ts:35`). Per bar: satu
  jahitan per 2 detik pada 120 bpm, dan karena `LEAD_MS = 300 > LOOKAHEAD_MS = 120` — ditambah
  serah terima yang ditunda sampai anchor (ADR-0004) — beat pertama grid baru selalu jatuh di
  depan ekor antrean grid lama → nol beat tertelan dan nol beat bolong di sepanjang 20 jahitan
  (dibuktikan test, bukan dikomentari — lihat ADR-0003).
- **Aksen diramp juga (per-bar ≠ per-beat-0)** — tidak berlaku: `retune` menaruh anchor di batas
  beat berikutnya, dan ramp hanya memicu di awal bar, jadi beat aksen lama dan baru jatuh di momen
  yang sama.

## Konsekuensi

**Lebih mudah:** jalur ramp = jalur tombol ±tempo yang sudah diserang test T5/T6; satu-satunya hal
baru adalah aritmetika `rampStep`, yang bisa diuji tanpa browser. Tidak ada migrasi, tidak ada
versi klien baru yang dipaksa.
**Lebih sulit:** ramp sepanjang 20 bpm butuh **43,6 detik** (20 bar, terhitung dari
`4·60000/bpm`) — kalau band butuh lebih cepat, yang diubah angka langkahnya, dan itu keputusan UI,
bukan arsitektur. Setiap langkah = satu tulis SQLite + satu siaran ke maksimal 12 socket.
**Risiko & penahan:** pemimpin yang tab-nya dibekukan OS di tengah ramp menghentikan ramp (tidak
ada alarm server), dan band akan melihat tempo berhenti berubah — bukan tempo yang bercabang.
Layar pemimpin menyebut status ramp di baris diagnostik supaya ini tidak diam-diam.
