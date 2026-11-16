# ADR-0006: `N HP` dihitung dari socket hidup, bukan dari riwayat tabel `member`

**Tanggal**: 2026-11-17 (= 2026-11-16T19:33:33.724Z dengan offset `-420`, jam `node -e
"console.log(new Date().toISOString(), new Date().getTimezoneOffset())"` saat dokumen ini diukur;
kode yang didokumentasikan diukur di `127.0.0.1:8787` pada 2026-11-16T19:09:46Z)
**Status**: accepted — tafsir "dedupe per `did`?" **SELESAI**, jawabannya socket mentah (lihat Alternatif 2)
**Dasar perintah**: arahan B0–B4 + §6.2 sesi pemeriksa `2d6f4ca7-3aba-44e4-ab8d-470daf00b560` (penanda
`S6` di rencana M3a §8.2), plus dua jawaban pemilik via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T09:16:14.324Z
(baris `S1` §8.2): "Socket hidup (getWebSockets)" dan "Rebut dengan lk, eksplisit". Tafsir "dedupe per
`did` unik?" juga jawaban pemilik via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:57:02.999Z
("Socket mentah"), ditegaskan ulang via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T20:36:32.241Z
sesudah konsekuensi 2-kursi dibacakan ke dia (baris `S7` §8.2). Arahan 16 Nov yang menyebut tafsir itu
"belum terjawab" ditarik checker sendiri 17 Nov, dan label *"did unik di antara socket hidup"* 15 Nov
dibatalkan sebagai keputusan pemilik via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:57:02.999Z,
bukan oleh keputusan saya. Kode karena itu memakai socket MENTAH, tanpa dedupe.

## Konteks

Janji yang ditulis M1b di README (bagian "M1b: klik yang terdengar", butir 7) ada dua: angka `N HP`
disegarkan oleh server lewat frame `state`, dan angkanya dibaca ulang dari `SELECT COUNT(*) FROM
member` "supaya orang ke-13 yang ditolak `FULL` tidak menambah satu HP hantu". Janji pertama benar;
yang kedua punya lubang yang tidak terlihat dari balik kalimat itu: `member` adalah **riwayat** (satu
baris per `did` yang pernah masuk, `INSERT OR IGNORE`), jadi angkanya hanya bisa NAIK. HP yang menutup
tab, HP yang baterainya mati, dan HP yang network-nya putus tidak pernah menghapus barisnya. Setelah
latihan pertama, ruangan melaporkan `12 HP` selamanya dan gerbang `FULL` menolak orang baru padahal
kursinya kosong.

M3a menyentuh angka yang sama dari sisi lain: otoritas pemimpin membuat identitas socket jadi hal
yang harus ada, dan identitas per-socket adalah tepat satu hal yang dibutuhkan untuk menghitung
kursi. Tempat penyimpanan identitas itu berubah dua kali dalam satu milestone: `b9fc0f3` menaruhnya di
`Map<WebSocket, {sid, did}>` milik instance (`:113` waktu itu) dan itu cacat — Map dihapus oleh
hibernasi — sehingga `a6ea775` memindahkannya ke attachment socket (`peerOf()` di `:92-98`).
Penghitungan kursi tidak ikut berubah; lihat [ADR-0007](0007-attachment-identitas-socket.md).

**Nomor baris di bawah diukur `grep -n` di atas `a6ea775`, bukan di atas `b9fc0f3`.** `a6ea775`
menambah 32 baris dan menghapus 15 di `SessionDO.ts`, jadi rujukan lama bergeser sekitar +16; kolom
kiri di setiap butir adalah nomor waktu ADR ini pertama diterima.

## Keputusan

Satu fungsi, dipakai di tiga tempat: `seatCount()` (`SessionDO.ts:169-174`; dulu `:153-159`) menghitung
socket yang `readyState === OPEN` dari `this.ctx.getWebSockets()`. **Angka mentah, tanpa deduplikasi
`did`.**

- Gerbang `FULL`: `!terdaftar && kursi > MAX_MEMBERS` (`:120-122`; dulu `:105-106`). Bentuk `total + 1`
  yang lama hilang karena socket yang masuk sudah menghitung dirinya sendiri.
- `members` di `welcome`: `kursi` (`:150`; dulu `:134`), sama seperti di `state`.
- `members` di `state`: `this.seatCount()` (`:256`; dulu `:240`) — dan supaya angka itu bisa TURUN,
  `webSocketClose` sekarang menyiarkan `state` (`:325-337`; dulu `:310-319`, dan catatan lama di README
  menulis `:310-319` padahal blok itu mulai `:309`). Ini perilaku baru di wire: sebelumnya
  `state` hanya lahir dari perubahan tempo/transport/anggota.
- Tabel `member` TETAP ada. Ia tidak lagi jadi dasar angka apa pun kecuali `rowsWritten` di
  `welcome`, yang masih dipakai untuk memutuskan apakah satu `hello` layak disiarkan. Aturan
  siaran `hello` jadi: socket baru **atau** `rowsWritten > 0` (`:160`; dulu `:141-144`) — dua belas HP yang reload
  serentak tetap tidak boleh mengirim dua belas frame ke ruangan yang sedang menghitung beat.
- `proto` tetap 2; isi frame `state` tidak bertambah dan tidak berkurang, hanya **arti** `members`
  yang berubah. Klien lama tetap membaca angka itu sebagai "N HP", dan mulai hari ini angkanya bisa
  turun — itu justru yang dijanjikan M1b.

## Alternatif yang dipertimbangkan

1. **Tetap `SELECT COUNT(*) FROM member`** — tolak: tidak menjawab penyakitnya. Angka tak pernah
   turun dan `FULL` jadi permanen sampai DO di-evict (terukur di `session.spec.ts:151-160`: sesudah
   satu HP pulang, `members` turun ke 12 dan orang yang tadi ditolak boleh masuk — dasar riwayat
   tidak bisa melakukan itu).
2. **Socket hidup dihitung per `did` unik** (`new Set(peers.map(p => p.did)).size`) — **pernah dijawab,
   lalu dibatalkan**: label opsi inilah yang pemilik centang 15 Nov, dan yang menggantinya adalah socket
   mentah — dua-dua ada alamatnya di "Dasar perintah" di atas (`S1`/`S2` 15 Nov, `S7` 16 Nov). Konsekuensi
   kalau keputusan ini dibuka lagi: dua tempat bergerak, gerbang `FULL` (`SessionDO.ts:120-122` di
   `a6ea775`; `:105-106` di `b9fc0f3`) dan
   `members` di `welcome` (`:150`; `:134` dulu), dan tes `session.spec.ts:149` pindah dari `members: 13` ke `12`. Hari
   ini tidak ada satu pun assertion yang mengasumsikan dedupe, dan itu memang isi jawaban 16 Nov.
3. **Hitung jumlah entri `peers`** (socket yang sudah `hello`) — tolak: yang membuka koneksi lalu
   tidak pernah `hello` jadi gratis, padahal socket itu tetap hidup dan tetap memakan koneksi DO.
   Kursi yang gratis adalah kursi yang bisa diborong.
4. **`getWebSockets()` tanpa filter `readyState`** — tolak: socket yang sedang dalam proses ditutup
   (`CLOSING`) masih terhitung, jadi siaran di `webSocketClose` melaporkan angka yang belum turun.
   Dua assertion yang menuntut angka SESUDAH penutupan meleset satu kursi kalau begitu:
   `session.spec.ts:156` (`members: 12`, sesudah satu HP pulang) dan `:595-599` (`members: 1`,
   sesudah socket kedua ditutup).

## Konsekuensi

**Lebih mudah:** `N HP` sekarang berarti kursi, bukan riwayat — ia naik saat orang masuk dan TURUN
saat orang keluar, dan tidak ada lagi ruangan yang terkunci `FULL` permanen; identitas socket yang
sudah dibutuhkan `assertLeader` (ADR-0005) dipakai untuk dua hal, tidak perlu dicatat dua kali.

**Lebih sulit — dan ini harga yang diterima, bukan sesuatu yang masih terbuka:** satu HP yang network-nya
flap atau me-reload halaman sebelum socket lama terdeteksi tutup memegang **dua kursi**. Terukur di
`session.spec.ts:145-149`: ruangan dengan 12 HP nyata melaporkan `members: 13` di `welcome`. Efek
lengkapnya: **kalimat M1b "orang ke-13 yang ditolak `FULL` tidak menambah satu HP hantu" tidak lagi
berlaku untuk angka kursi** — yang ditolak memang tidak menyiarkan apa pun (tes `:302-331` masih
menuntut `members` terakhir ruangan tetap 12 dan tidak ada frame baru sama sekali), tapi socket-nya
hidup dan terhitung di siaran berikutnya. Dua belas HP yang reload serentak di tengah latihan bisa
menjatuhkan orang-orang berikutnya ke `FULL` palsu. Angka `13` itu bukan temuan yang menunggu putusan:
ia konsekuensi yang diketahui pemilik saat menjawab socket mentah via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T20:36:32.241Z,
dan tidak ada satu pun baris kode M3a yang menahannya. Kalau angka ini terasa salah di lapangan, yang
perlu diubah adalah jawabannya — bukan kodenya diam-diam.

**Risiko & penahan:** `getWebSockets()` hanya menghitung socket di isolate DO ini — itu memang
defenisi "kursi di ruangan ini", tapi berarti angka itu ikut hilang saat DO di-evict sementara baris
`member` bertahan; untungnya `peers` dibangun ulang dari `hello` berikutnya dan `leader` terbaca dari
SQLite, jadi tidak ada keadaan yang bercabang dua. Kapasitas 12 masih bisa dihabiskan oleh koneksi
yang sengaja dibuka dan tidak pernah `hello`; tidak ada penahan untuk itu di M3a (rate limit ada di
`/create`, bukan di `/ws`), dan itu konsekuensi langsung dari Alternatif 3.

## Test

`src/worker/session.spec.ts`: `ke-13 ditolak FULL, dan kursi dari socket yang ditutup bisa dipakai
lagi` (`:122`, termasuk angka hantu `members: 13` di `:149`), `orang ke-13 ditolak FULL tanpa membuat
hitungan HP jadi 13` (`:302` — kesimpulannya tetap, alasannya pindah dari SQL ke socket), dan tes baru
`socket yang ditutup menurunkan jumlah kursi di layar HP yang masih di dalam` (`:584`; tanpa tes ini
butir 2c jadi cabang tak teruji). Rencana §4 mendaftarkan delapan posisi assertion `members` lama;
barisnya sudah bergeser karena enam tes baru, jadi yang saya baca ulang adalah **19** assertion
`members` yang ada di berkas hari ini (`:105, :116, :118, :135, :149, :156, :160, :256, :267, :276,
:295, :327, :351, :468, :492, :560, :569, :590, :599`) dan `rowsWritten: 0` pada tes reconnect
(`:118`) tetap sah karena tabel `member` tidak dihapus. Sisi stack hidup: `scripts/attack.ts`
**T12s** — 12 socket `hello` dijawab 12 `welcome` + `state`, kursi dihitung dari koneksi nyata.
