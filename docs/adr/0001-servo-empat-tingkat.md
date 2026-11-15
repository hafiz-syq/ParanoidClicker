# ADR-0001: Servo koreksi θ 4 tingkat, bukan servo bebas

**Tanggal**: 2026-11-15
**Status**: accepted
**Dasar perintah**: `QODER.md:56` (M2 = `ecc:tdd-workflow` + `ecc:architecture-decision-records`),
kontrak M2 butir 1 dari sesi pemeriksa, tabel keputusan M0 di README (`p95 ≤ 15 ms → servo 4 tingkat cukup`).

## Konteks

θ (selisih jam HP terhadap jam Durable Object) diestimasi ulang setiap pong, 1 Hz
(`live.ts:26` `PING_INTERVAL_MS = 1_000`, `estimateOffset(samples, k = 4)`). Sampai hari ini
`ClickEngine.setTheta()` (`click.ts:122` pada `HEAD` sebelum M2) menukar θ sekaligus, dan kepala
kelasnya mencatat konsekuensinya sebagai `shortcut: tanpa servo (M2)` (`click.ts:63` pada berkas
yang sama). Angka lapangan M0: jitter p95
**2,0 ms**, θ awal HP #1 **657 ms**. Jadi yang harus diperbaiki berdimensi milidetik (spike
jaringan), tapi ada satu kelas kesalahan 657 ms yang tidak boleh diperlakukan sama.

## Keputusan

Koreksi θ dijalankan bertahap dalam **tepat 4 tingkat**, satu tingkat per tick scheduler
(`TICK_MS = 25` → koreksi selesai dalam 100 ms), sebagai aritmetika murni di
`src/app/sync/servo.ts`; engine hanya menyimpan state servo dan membacanya. Angka 4 tidak
boleh dibuka lagi tanpa ADR baru yang men-*supersede* yang ini.

Tiga aturan pendamping, semuanya terukur:

- **Tingkat terakhir mendarat tepat di target** — servo tidak boleh melewati target, dan tidak
  boleh meninggalkan sisa yang menggenang sampai pong berikutnya.
- **|kesalahan| < 0,5 ms langsung dilalap** — di bawah resolusi `Date.now()` (1 ms) empat tingkat
  cuma jadi getaran, dan residunya membuat θ akhir tidak pernah sama dengan estimasi yang tampil
  di layar.
- **|kesalahan| ≥ setengah periode beat dilompat sekaligus dan dicatat di stat** (`lompat θ`),
  bukan diramp. Setengah periode pada 120 bpm = 250 ms; selama 100 ms ramp, HP ini *out of phase*
  dengan seluruh band, dan itu lebih buruk daripada satu klik yang tergeser. Ini jalur pemulihan,
  bukan jalur jitter. Sebelum satu beat pun disetel (θ pertama dari `welcome.serverNow`, atau HP
  yang belum pernah bunyi), θ bukan koreksi sama sekali — langsung dipakai, supaya klik pertama
  tidak datang telat 657 ms.

**NUDGE_ONLY** diberi arti yang bisa diuji, bukan nama kosong: servo adalah satu-satunya jalur
koreksi fase di klien, dan ia **tidak pernah** menulis `anchorMs` maupun mengirim frame apa pun ke
server. Yang boleh mengubah grid bersama hanyalah pemimpin, lewat tombol ±tempo / ramp (ADR-0002).
Bedakan namanya: `nudge(delta)` di `ClickRoom.tsx:203` = perintah manusia ke server; NUDGE_ONLY =
batas wewenang servo. Test-nya: servo dipaksa bekerja 20 detik dengan θ bergoyang, `sent[]` socket
harus kosong dan `anchorMs` harus tidak berubah.

## Alternatif yang dipertimbangkan

- **Servo bebas (PI/kalman, gain adaptif dari jitter)** — tolak: tidak ada satu pun alat di 11 HP
  band yang bisa memverifikasi konstanta tuning-nya, dan M0 mengukur 2,0 ms. Kepadatan frekuensi
  kesalahan yang dibayar tidak ada.
- **Re-anchor tiap pong (server menulis ulang `anchorMs`)** — tolak: satu spike jaringan satu HP
  menjadi jahitan tempo untuk dua belas HP, dan gerbang "anchor identik antar-perangkat" hilang.
- **Ramp per beat, bukan per tick** — tolak: konvergensi 4 beat = 2 detik pada 120 bpm; kelas
  kesalahan 20–250 ms akan terdengar sebagai HP yang "tertinggal" selama dua detik, padahal
  100 ms tidak terdengar sama sekali.
- **Tetap tanpa servo (perilaku sekarang)** — tolak: janji di kode sendiri sudah jatuh tempo, dan
  klik yang terpindah sekaligus sebesar Δθ di batas beat adalah keluhan "kliknya beda sendiri".

## Konsekuensi

**Lebih mudah:** θ yang dibaca klik dan θ yang dibaca layar jadi angka yang sama, dan sisa
kesalahannya terlihat (`thetaMs` vs target). Lonjakan 15 ms tidak lagi menghasilkan satu klik yang
melompat. Konvergensi monoton: tidak ada lintasan yang bisa berosilasi.
**Lebih sulit:** engine menyimpan satu state lagi (`click.ts:88`), dan state itu sengaja **tidak**
dinolkan oleh `stop()` maupun `setGrid`: θ adalah sifat jam perangkat, bukan sifat lagu — HP yang
men-stop lalu start kembali tidak boleh mulai dari asumsi 0 ms. Harga dari keputusan itu adalah
diagnostik bertambah dua baris yang harus dipahami operator (`lompat θ`, `beat tertelan`).
**Risiko & penahan:** tab yang bangun dari tidur membawa θ basi → jalur lompat memicu satu klik
tergeser; ditahan oleh `pingNow()` pada `visibilitychange` (`ClickRoom.tsx:184`) plus stat `lompat θ`
yang tidak pernah diam-diam. Servo yang hanya benar saat `rate == 1` adalah kegagalan ganda —
`appliedMs` masuk ke konversi jam lewat `serverNowMs()`, jadi laju audio 2,3× (headless) dan 0,993×
(tab di-throttle) ikut ditutup test, bukan diasumsikan.
