# M8 irisan 1 — worker mati / redeploy di tengah lagu

**Tanggal**: 20 November 2026
**Status**: **IRISAN 1 DIKERJAKAN**. Bukti di §5.

## 1. Masalah

`LiveSession` sudah reconnect dengan backoff dan klik lokal sudah freewheel saat socket putus. Yang
belum diputuskan: apa yang terjadi pada **grid** ketika pengikut masuk lagi dan tempo pemimpin sudah
berubah selama ia buta. Hari ini frame `state` baru langsung diadopsi di beat berikutnya —
`adoptIndex` mencegah klik ganda dan cursor mundur, tapi perpindahan tempo bisa jatuh di tengah bar.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| R1 | Klik lokal tidak pernah menunggu socket; saat putus, grid terakhir terus berbunyi | Sudah begitu; di sini hanya dibuktikan, bukan diubah |
| R2 | Reconnect: frame `state` pertama dipakai untuk menandai "sudah sambung lagi", bukan untuk mengubah grid | θ baru saja diganti sampel rute baru; grid harus diputuskan sekali, bukan per frame |
| R3 | Kalau periode grid berubah selama putus, grid baru diadopsi **di batas bar grid lama**, bukan di beat berikutnya | Perubahan tempo di tengah bar terdengar sebagai patah, dan itulah satu-satunya saat klik ganda/bolong bisa lahir |
| R4 | Grid baru dibuat dengan `anchorMs` = batas bar berikutnya, sehingga mekanisme `pending` engine (ADR-0004) yang menyerahkan grid tepat di anchor | Tidak perlu jalur baru di engine; yang ada sudah menunda serah terima sampai anchor |
| R5 | Batas bar dihitung dari grid yang **sedang berbunyi**, bukan dari grid baru | Yang didengar band adalah bar mereka sekarang |
| R6 | Grid tidak berubah (periode sama) → tidak ada adopsi sama sekali | Fase sudah benar; servo θ yang mengoreksi sisa selisih, bukan lompatan grid |

## 3. Berkas

- `src/app/sync/schedule.ts` — `nextBarMs(grid, serverNowMs)` murni.
- `src/app/sync/schedule.spec.ts` — tes batas bar & grid tak sah.
- `src/screens/ClickRoom.tsx` — `putusRef` (dari status "terputus"), `pushGrid(barAlign)`,
  `reanchorAtBar` lewat `nextBarMs`.

## 4. Yang sengaja belum

Serah terima pemimpin (M3 lanjutan), re-anchor berkala sepanjang set (drift jam), dan tampilan
"tersambung lagi" selain baris status yang sudah ada.

## 5. Bukti yang harus ada

| # | Bukti | Cara |
|---|---|---|
| S1 | `npm run check` EXIT=0, termasuk tes `nextBarMs` | gerbang yang sama |
| S2 | Dua klien: server dimatikan di tengah lagu, pengikut tetap mengeklik dan `played` bertambah | matikan proses preview, baca stats pengikut |
| S3 | Server hidup lagi: pengikut reconnect, `hilang` tidak melonjak, θ kembali segar | baca status + stats sebelum/sesudah |
| S4 | Grid yang berubah saat putus diadopsi di batas bar | tes unit `nextBarMs`/adopsi (tanpa dua HP) |

## 6. Hasil

| # | Hasil | Bukti |
|---|---|---|
| S1 | **LULUS** | `npm run check` EXIT=0 (140 unit / 39 worker); `schedule.spec.ts` 22 tes |
| S2 | **LULUS** | sesi `7LCV`, pengikut 8 klik → server dimatikan → 41 klik, `0 hilang`, status `percobaan lagi ke-2…` |
| S3 | **LULUS** | server hidup lagi: `terhubung`, 90 klik, `0 hilang`, `0 tertelan`, θ −0,5 ms umur 558 ms, grid/anchor sama |
| S4 | **LULUS di tingkat unit** | `nextBarMs` selalu bar di depan (termasuk tepat di garis bar → bar sesudahnya); adopsi grid ber-anchor bar mulai di beat 1, jarak ke beat bar = satu periode baru, `swallowed=0` |

Batas bukti: dua klien tidak bisa dibuat berbeda nasib — mematikan worker memutus keduanya, jadi
"tempo berubah selagi pengikut buta" hanya dibuktikan di tes unit, bukan di dua HP. Jalur reconnect
yang dieksekusi di browser adalah kasus periode sama (tidak ada adopsi grid, sesuai R6).
