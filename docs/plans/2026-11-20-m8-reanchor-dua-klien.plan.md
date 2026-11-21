# M8 irisan 2 — worker mati / redeploy di tengah lagu (re-anchor bar)

**Tanggal**: 20 November 2026
**Status**: dikerjakan; bukti dua klien di §5.

## 1. Masalah

Saat worker mati/redeploy, kedua HP kehilangan socket. Klik lokal sudah freewheel dari grid
terakhir, tapi saat pengikut masuk lagi ada dua risiko:

1. frame `state` baru diadopsi di tengah bar (tempo/anchor berubah selama ia buta), dan
2. adopsi yang salah bisa menyetel beat yang sudah dibunyikan (klik ganda) atau melewati beat
   (klik kosong).

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| R1 | Klik lokal tidak menunggu socket; grid terakhir terus berbunyi selama putus | Satu-satunya cara band tetap jalan saat worker mati |
| R2 | Reconnect: frame `state` pertama sesudah putus memicu jalur re-anchor, bukan adopsi langsung | θ dari sampel lama tidak boleh menyeret grid baru |
| R3 | Grid baru (tempo **atau** anchor berbeda) diberi anchor batas bar berikutnya dari grid yang sedang berbunyi | Perpindahan di tengah bar terdengar sebagai patah; garis bar adalah satu-satunya jahitan yang aman |
| R4 | Grid yang benar-benar identik (anchor + periode) tidak diadopsi ulang | Tidak ada yang perlu dijahit; servo θ yang mengoreksi sisa selisih |
| R5 | Serah terima memakai mekanisme `pending` engine (ADR-0004): grid lama terus menyetel beat sampai anchor baru | Tidak ada beat yang hilang di antara dua grid |
| R6 | Cursor mengikuti `adoptIndex` (tidak pernah mundur) dan `swallowed` dihitung | Beat yang sudah diantrekan tidak boleh dibunyikan dua kali |

## 3. Berkas

- `src/screens/ClickRoom.tsx` — `putusRef`, `rebaseRef`, `pushGrid(barAlign)`, `nextBarMs`.
- `src/app/sync/schedule.ts` + `.spec.ts` — `nextBarMs` (murni).
- Tidak ada perubahan worker: anchor baru tetap dihitung klien dari grid yang terdengar.

## 4. Yang sengaja belum

Rekonsiliasi anchor lintas HP selain lewat frame `state`, dan penyesuaian fase antar-HP
selama putus (θ hanya dikoreksi setelah pong pertama).

## 5. Bukti yang harus ada

| # | Bukti | Cara |
|---|---|---|
| S1 | Worker dimatikan: klik kedua HP terus bertambah | matikan proses preview, baca `klik … berbunyi` |
| S2 | Worker hidup lagi: pengikut `terhubung`, klik tidak melonjak, `hilang`/`tertanan` 0 | baca diagnostik dua tab |
| S3 | Pengikut putus sendiri saat pemimpin ganti tempo: anchor baru jatuh di kelipatan 4 beat grid lama | selisih anchor baru−lama modulo `4×periode lama` = 0 |
| S4 | Tidak ada klik ganda/kosong di jahitan | `beat tertelan di jahitan 0`, `hilang 0`, klik terus bertambah |
| S5 | `npm run check` EXIT 0 | gerbang biasa |
