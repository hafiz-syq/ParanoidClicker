# ADR-0005: Otoritas pemimpin = kunci `lk` yang dicetak terpisah, rebut hanya lewat tombol

**Tanggal**: 2026-11-17 (= 2026-11-16T19:33:33.724Z dengan offset `-420`, jam `node -e
"console.log(new Date().toISOString(), new Date().getTimezoneOffset())"` saat dokumen ini diukur;
kode yang didokumentasikan diukur di `127.0.0.1:8787` pada 2026-11-16T19:09:46Z)
**Status**: accepted
**Revisi ronde M3a #4**: `S8` terjawab — pemilik memilih **"(b) Ikat ke lk terverifikasi"** via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T23:06:05.165Z.
Kode mendarat di `f383335` sesudah tes E MERAH di `0967b4e` (`73464b2`); bagian "Batas yang terukur di
ronde M3a #3" di bawah ini adalah RIWAYAT yang tetap berlaku sebagai ukuran saat itu, dan kotak [TANYA]
di ujungnya sudah diganti dengan jawabannya. Nomor baris `SessionDO.ts` di ADR ini disegarkan ke `f383335`
karena perbaikan itu sendiri yang menggesernya (+7…+23); angka lama masih bisa dibuka dengan
`git show a6ea775:src/worker/SessionDO.ts` dan `git show 343a020:...`.
**Dasar perintah**: arahan B0–B4 sesi pemeriksa `2d6f4ca7-3aba-44e4-ab8d-470daf00b560` (penanda `S6`
di `docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md` §8.2) atas rencana M3 §3. Isi ADR ini empat
jawaban §6 yang pemilik berikan 2026-11-15, via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T09:16:14.324Z
(baris `S1` tabel §8.2, kanalnya AskUserQuestion): "Setuju, tapi jangan kode dulu" · "Socket hidup
(getWebSockets)" · "Rebut dengan lk, eksplisit" · "M3b terpisah".

## Konteks

Sampai M2, "pemimpin" hanya sebuah peran di sisi layar. `main.tsx:13-18` mengambilnya dari URL —
`?sid=&tok=` yang sah berarti `<ClickRoom role="follower">` (`:17`) dan selain itu layar `Start` —
sedangkan peran `leader` lahir dari tombol "Buat sesi baru (saya pemimpin)" (`Start.tsx:34`) atau
dari `remembered.leader` di `localStorage` (`:40`). Tombol ±tempo dan Start/Stop menyala di HP yang
memegang keadaan itu; server tidak pernah ikut memilih. Karena itu `SessionDO` hari itu menerima
`tempo`/`start`/`stop` dari **socket mana pun** yang punya token sesi — komentar yang dihapus commit
`b9fc0f3` (`SessionDO.ts:160` di `178e1e9`) menyebutnya `shortcut: siapa pun yang punya
socket sesi boleh mengganti tempo … Ditutup di M3`. Token itu (`tok`) duduk di query string `/ws`,
disalin ke tautan join, dan tautan itulah yang dibagikan ke sebelas HP. Jadi setiap personil yang
membuka DevTools bisa mengirim `tempo` dan memindahkan dua belas layar sekaligus.

Yang tidak bisa diselesaikan di sisi layar: tidak ada satu pun frame di wire yang mengatakan "kamu
pemimpin". Server tidak pernah membedakan identitas pengirim, dan `did` yang dibayar di `live.ts`
adalah string yang bisa dikarang siapa pun yang punya socket. Karena itu otoritas harus lahir dari
bukti yang dimiliki HP, bukan dari peran yang disimpan layar.

## Keputusan

Dua kapabilitas terpisah di atas kunci ruangan yang sama (`src/worker/keys.ts`):

- `tok = HMAC-SHA-256(kunci, sid)` — kapabilitas **sesi**. Masih di query string `/ws`, masih di
  tautan join, masih belum bisa direvoke (`live.ts:300` masih menulis "Kedaluwarsa token: M3.").
- `lk = HMAC-SHA-256(kunci, sid + ":leader")` — kapabilitas **pemimpin**. Ruang nama berbeda, jadi
  `tok` sah tidak pernah bisa dipakai sebagai `lk`. Dicetak hanya di JSON `/create`
  (`index.ts:39`), disimpan di `localStorage` HP itu (`live.ts:308-316`), dan **tidak pernah** masuk
  URL, `wsPath`, tautan join, QR, atau log.

DO mencatat pemegang podium di baris tunggal `leader (id INTEGER PRIMARY KEY CHECK (id = 1), did,
lk_hint, claimed_at)` — `CHECK(id = 1)` dipakai lagi karena polanya sama dengan tabel `tempo`:
keadaan tidak boleh bercabang. `hello` memverifikasi `lk` (`SessionDO.ts:144`) dan menyimpan hasilnya di
attachment socket sebagai flag `lkDibuktikan` (`:145`), lalu mengikat `did` ke podium hanya kalau flag itu
benar DAN belum ada pemegang (`:159`); tiga frame perintah dijaga `assertLeader(ws)` (`:220-226`, dipakai
di `:314` dan `:325`) yang bertanya ke **socket**, bukan ke `did` di dalam frame, dan sejak ronde #4
menuntut **dua** hal: `peer.lkDibuktikan` DAN `leaderDid() === peer.did` (`:222`). Rebut kendali ada,
tapi hanya lewat frame `claim` yang membawa `lk` dan memverifikasinya ulang dari frame itu
(`:231-242`, verifikasi di `:234`), yang kalau lulus ikut menulis flag di attachment socket pengclaim
(`:238`), dipicu tombol "Ambil kendali" (`ClickRoom.tsx:315-318`) yang muncul justru setelah server
menjawab `NOT_LEADER`.

**Yang dicabut dari kalimat di atas, dan kenapa.** Versi pertama ADR ini menulis bahwa identitas socket
"diambil dari `Map<WebSocket, {sid, did}>` hasil `hello` yang berhasil (`:113`)" — itu memang kode yang
lahir di `b9fc0f3`, dan kode itu cacat: `fetch()` memakai Hibernation API, jadi sesudah DO tidur
runtime memanggil handler dengan objek socket baru yang tidak ada di Map itu, dan pemimpin sah dijawab
`NOT_LEADER` bahkan lewat `claim` ber-`lk` yang benar. Nomor baris di paragraf di atas karena itu
diukur ulang di `a6ea775`, tempat identitas dibaca dari attachment socket lewat `peerOf()` (`:99-108`,
ditulis `remember()` di `:110-112` saat `hello` `:145`). Keputusan di ADR ini tidak berubah — otoritas
tetap `lk`, rebut tetap eksplisit — yang berubah hanya tempat kebenaran itu disimpan; itu ada di
[ADR-0007](0007-attachment-identitas-socket.md).

**Dan satu tambahan lagi di ronde #4, yang kali ini MEMANG mengubah aturan.** Attachment sekarang
`{sid, did, lkDibuktikan}` (`Peer` di `:14-25`, field di `:24`; dibaca dari attachment di `peerOf()` lewat
`ws.deserializeAttachment()` `:102` dan hanya diakui kalau nilainya `=== true` `:107`, ditulis lewat
`ws.serializeAttachment(peer)` `:111`). Alasannya ada di
bagian "Batas" di bawah: selama `assertLeader` hanya membandingkan `did`, socket kedua yang mengarang `did`
pemimpin ikut memerintah. Nomor baris paragraf ini adalah `f383335`; yang saya segarkan dari `a6ea775`
hanya angkanya, bukan kalimat "Keputusan di ADR ini tidak berubah" di atas — kalimat itu masih benar untuk
`a6ea775` dan sudah tidak benar untuk `f383335`, dan cara menuliskannya yang sekarang adalah menyebut yang
kedua-duanya, bukan menghapus yang pertama.

## Alternatif yang dipertimbangkan

- **Klaim-pertama-datang** (siapa yang `hello` lebih dulu memimpin) — tolak: yang membuka tautan
  lebih cepat jadi diktator, dan setelah DO di-evict orang asing bisa menjadi pemimpin sesi yang
  sedang berjalan. Persis kegagalan yang mau ditutup.
- **PIN join** — tolak untuk M3a: pantas hidup di M4 bersama QR, bukan sekarang; hari ini yang
  dibagikan tetap satu tautan dan PIN tidak membedakan pengirim `tempo` dari pendengar.
- **Otoritas tanpa kunci** (server memakai `did` pertama yang dilihatnya) — tolak: server tidak bisa
  membedakan pemimpin dari pengikut, dan itu justru intinya; `did` adalah string klien.
- **Rebut otomatis tanpa tombol** — tolak: podium pindah diam-diam di tengah lagu lebih buruk dari
  tidak ada pemimpin sama sekali, karena sebelas HP tidak tahu siapa yang memegang.
- **`lk` di query string `/ws` supaya tidak perlu frame baru** — tolak: `wsPath` disalin ke tautan
  join dan akan menjadi QR, jadi kapabilitas pemimpin ikut terbagi ke sebelas HP dan ke setiap log
  proxy di antaranya.

## Konsekuensi

**Lebih mudah:** penolakan datang dari server, jadi klien lama dan klien baru menjawab dengan aturan
yang sama; `NOT_LEADER` tidak perlu didaftarkan di mana pun (`live.ts:259` sudah mencetak apa yang
datang sebagai `server menolak: <kode>`); reconnect pemimpin dengan `did` yang sama
("Lanjut ke sesi") mendapat kendalinya kembali tanpa `/create` baru; `lk_hint` 8 hex cukup untuk
membuktikan rebut yang misterius memakai kunci mana tanpa menyimpan kapabilitasnya.

**Lebih sulit:** satu rahasia kedua beredar. Ia tidak lewat jaringan ke HP pengikut, tapi dia duduk
di `localStorage` HP pemimpin — dan `localStorage` adalah input pengguna (siapa pun yang bisa membuka
DevTools bisa membacanya), jadi `readRemembered` memvalidanya dengan pola hex yang sama sebelum
memakainya. Deploy hari pertama membuat HP pemimpin yang sudah ter-install tidak bisa memerintah
sesi yang ia buat sendiri, karena ia tidak pernah melihat `leaderKey`; itu bukan bug, itu
gagal-tertutup yang dipilih, dan satu-satunya jalan keluarnya adalah memperbarui klien.

**Risiko & penahan:** `tok` belum bisa dicabut, jadi kunci yang bocor tetap berlaku sampai
kedaluwarsa token dibereskan — pekerjaan yang sampai hari ini masih berupa satu baris komentar di
`live.ts:300` ("Kedaluwarsa token: M3."), bukan kode. Podium boleh berpindah tangan lewat `claim`
dari HP yang memegang `lk` yang sama — itu memang desainnya (dua HP pemimpin = rebut eksplisit,
bukan dua-dua diam). Tidak ada revocation di M3a; yang ada cuma kunci.

## Batas yang terukur di ronde M3a #3: sesudah podium terikat, `did` ikut membawa otoritas

**Bukan regresi `a6ea775`, dan bukan temuan yang baru lahir ronde ini — ini perilaku yang ada sejak
otoritas dibuat.** `assertLeader` (`SessionDO.ts:200` di `343a020`) menjawab "pemimpin" dengan membandingkan
`did` hasil `hello` yang tersimpan di attachment terhadap `leaderDid()`:

```
if (peer && this.leaderDid() === peer.did) return true;
```

Baris itu TIDAK ADA LAGI di `f383335`, dan itulah isi perbaikan ronde #4. Yang sekarang (`SessionDO.ts:222`):

```
if (peer && peer.lkDibuktikan && this.leaderDid() === peer.did) return true;
```

`lkDibuktikan` adalah hasil `verifyLeaderKey` yang tersimpan di attachment socket — ditulis hanya di `hello`
yang verifikasinya lulus (`:144-145`) atau di `claim` yang verifikasinya lulus (`:234-238`), dan tidak bisa
diisi dari frame mana pun.

Yang dibandingkan adalah **`did`**, dan `did` diambil dari frame kiriman klien (`:107` di `343a020`, `:117`
di `f383335`; yang dijaga server cuma panjang 1–32 karakter di `:110`/`:120`, tidak ada charset). Karena itu,
sesudah satu `lk` pernah mengikat podium,
socket KEDUA yang mengaku `did` yang sama — tanpa membawa `lk` — lulus `assertLeader` dan boleh menulis
keadaan ruangan. Diukur dua kali, di dua worktree, dengan kunci yang berbeda:

```
# pc-verify3 (pemeriksa, sid JRX5) — 3 passed (3), EXIT=0, 3944ms
P3 welcome peniru = {"t":"welcome","sid":"JRX5","did":"lead0013","serverNow":1794866070972,"members":2,"rowsWritten":0}
P3 frame baru untuk peniru ber-did sama = [{"t":"state","bpm":177,"anchorMs":null,"running":false,"members":2}]
P3 tempo 177 diterima tanpa lk = true

# pc-exec-r3 (saya, sid 7TS5, .dev.vars sintetis 64 nol — bukan salinan tree utama) — 3 passed (3), EXIT=0, 3878ms
P3 welcome peniru = {"t":"welcome","sid":"7TS5","did":"lead0013","serverNow":1794867241599,"members":2,"rowsWritten":0}
P3 frame baru untuk peniru ber-did sama = [{"t":"state","bpm":177,"anchorMs":null,"running":false,"members":2}]
P3 tempo 177 diterima tanpa lk = true
```

Urutan probe-nya: pemimpin `hello` ber-`lk` (did `lead0013`) → `tempo 140` diterima → socket baru `hello`
dengan `did: 'lead0013'` TANPA `lk` → `tempo 177` → diterima dan disiarkan ke ruangan.

Asal-usulnya saya ukur di git, bukan disimpulkan: `git show b9fc0f3:src/worker/SessionDO.ts` mencetak baris
pembandingan yang sama di `:184`, dan `git show 178e1e9:src/worker/SessionDO.ts` tidak punya `assertLeader`,
`leaderDid`, maupun `NOT_LEADER` sama sekali (`grep -c` = 0). Perbaikan attachment hanya memindah TEMPAT
`did` disimpan; aturan "siapa yang boleh memerintah" tidak ikut berubah.

**Prasyarat yang saya ukur supaya lubang ini tidak dibesar-besarkan dan tidak dikecilkan.** `did` adalah 8
byte acak jadi 16 hex (`genDid()` di `src/shared/ids.ts:32-36`), dibaca dari `localStorage` (`live.ts:295`,
kunci `paranoidclick.did`), dan tidak pernah disiarkan: `welcome` hanya dikirim ke socket pengirimnya
(`SessionDO.ts:144-153` di `343a020`, `:162-171` di `f383335`), frame `state` tidak memuat `did` (`:251-257`
di `343a020`, `:274-280` di `f383335`), dan `grep -rn "\bdid\b" src/screens`
mencetak 3 baris — dua komentar (`ClickRoom.tsx:35`, `:61`) dan satu pengiriman `hello`
(`DebugScope.tsx:205`); tidak satu pun menampilkan `did` pemimpin. Jadi yang cuma memegang `sid` + `tok` —
orang yang membuka tautan join — tidak memakai jalur ini. Yang bisa: pihak yang sudah tahu `did` pemimpin
(HP dipakai bersama, akses fisik, XSS di satu layar, atau mengetik sendiri di DevTools HP pemimpin).

**Kenapa ini wajib tercatat di ADR dan bukan di log percakapan.** Bagian "Alternatif" di atas menolak
"otoritas tanpa kunci" dengan alasan "`did` adalah string klien", dan bagian "Keputusan" menyebut `lk`
sebagai kapabilitas pemimpin. Kode hari ini membuat `did` ikut menjadi pembawa otoritas untuk socket mana
pun yang cocok, sesudah `lk` dipakai satu kali. Kontrak dan implementasi tidak bercerita hal yang sama.
Kata "aman" dan "cukup" sengaja tidak dipakai di bagian ini: yang ditulis di atas adalah apa yang dilakukan
kode, bukan penilaian terhadapnya.

**Dua model yang pernah tersedia, dan jawaban pemilik atasnya.** Kotak ini dulu [TANYA]; ia terjawab di
ronde M3a #4, dan pemilik memilih **(b)** — via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T23:06:05.165Z
— dengan konsekuensi **(a) ditolak**: perilaku "`did` yang cocok = boleh memerintah" tidak dikunci sebagai
desain. Yang saya cocokkan sendiri di transkrip pemeriksa (`Grep`, bukan `node`/`sed`): baris 3794 adalah
`type: user` dengan field `"timestamp":"2026-11-16T23:06:05.165Z"`, `"type":"tool_result"`, dan
`"tool_use_id":"call_8f1f79b4baf847cfb47cecaf"`, dan isinya memuat kedua verbatim — `Ikat ke lk terverifikasi`
dan `Mulai M3b (setlist)`, dalam satu tool_result yang sama. uuid pesan
`40875e22-d283-47db-bf24-b8d507802756` saya salin dari relai checker dan TIDAK saya konfirmasi sebagai field
di berkas itu: ekstraksi sedalam itu kena blok `[Session Transcript Tampering]` ronde ini, dan saya tidak
mengakalinya. Kedua opsi saya biarkan tertulis di bawah apa adanya, supaya jejak pilihannya ada:

- **(a) Terima perilaku sekarang.** `did` yang cocok = boleh memerintah. Dikunci dengan tes permanen yang
  MENUNTUT `tempo 177` diterima di jendela socket ber-`did` sama tanpa `lk` — yaitu mengunci perilaku ini
  sebagai desain, supaya kalau nanti dibalik, yang berubah adalah tesnya dan perubahannya terlihat.
  **DITOLAK.**
- **(b) Ikat otoritas pada flag di attachment** yang hanya ditulis ketika `verifyLeaderKey` lulus (di
  `hello` maupun `claim`), sehingga `assertLeader` menuntut flag itu DAN `leaderDid() === peer.did`. Socket
  tanpa `lk` tidak pernah boleh memerintah walau `did`-nya benar. Pemeriksa merekomendasikan (b) dan sudah
  mengukur bahwa jalan pulang pemimpin tidak terputus olehnya: `live.ts:94`
  `if (this.target.lk) hello.lk = this.target.lk;` mengirim `lk` di SETIAP `hello` selama target punya
  kunci, dan "Lanjut ke sesi" memulihkan `lk` dari `localStorage` — jadi reconnect pemimpin pasca-evict
  tetap bekerja. **DIPILIH, dan inilah `f383335`.**

**Perubahan perilaku yang harus disebut, bukan diselipkan** (ini tujuan (b), bukan cacat turunannya): HP yang
memegang `did` pemimpin tapi tidak memegang `lk` **tidak bisa lagi memerintah** — ia dijawab `NOT_LEADER` dan
satu-satunya jalan pulang adalah `claim` ber-`lk` (tombol "Ambil kendali"). Di kode sebelum ronde #4 HP yang
sama boleh mengubah tempo, start, dan stop. Klien normal tidak melewati jalur itu: `live.ts:94` selalu
mengirim `lk` di `hello` selama target masih punya kuncinya, dan `readRemembered` (`live.ts:322`)
mengambilnya kembali dari `localStorage` sesudah reload. Yang berubah perilakunya adalah sisi yang memang
sedang ditolak — dan itu sisi yang tidak saya ukur di browser (lihat "Test" dan README bagian ronde #4).

**Satu perubahan perilaku lagi, lebih kecil, dan sengaja:** flag `lkDibuktikan` ikut ter-set setiap kali
verifikasi `lk` lulus, **termasuk** ketika podium sudah dipegang `did` lain (`SessionDO.ts:144` menulis flag
sebelum `:159` memutuskan mengikat atau tidak). Efeknya: socket yang prove `lk` tapi tidak menjadi pemimpin
tidak otomatis boleh memerintah — `assertLeader` tetap menuntut `leaderDid() === peer.did` yang kedua — jadi
ini bukan jalan pintas, cuma keadaan yang bisa diamati lewat `deserializeAttachment` di dalam DO. Pemeriksa
menyatakan perilaku ini boleh, dengan syarat disebut; itu paragraf ini.

**Yang TIDAK berubah oleh (b):** `proto` tetap 2, `src/shared/limits.ts` tidak disentuh, dan frame
`tempo`/`start`/`stop` **tetap tidak** membawa `lk` maupun `did` — alternatif "bukti per frame" sudah ditolak
di [ADR-0007](0007-attachment-identitas-socket.md) sebelum (b) dijawab, dan (b) tidak membukanya kembali.
`seatCount()` tetap menghitung socket OPEN mentah (S7), dan `webSocketError` tetap diam (ADR-0007).

## Test

`src/worker/session.spec.ts` (+5): pengikut tanpa `lk` yang mengirim `tempo` ditolak dan grid
ruangan tidak tersentuh (dibandingkan sebagai teks state mentah, bukan angka hasil parse); HP yang
membawa `lk` boleh mengubah tempo; pemimpin yang reconnect dengan `did` sama tetap pemimpin tanpa
`/create` baru; dua HP yang sama-sama membawa `lk` sah — yang pertama mengikat, yang kedua tidak
memerintah; `claim` dengan `lk` memindahkan podium dan menyiarkan `state`, `claim` tanpa `lk` tidak
menggeser apa pun. `src/app/session/live.spec.ts` (+2): `hello` membawa `lk` hanya kalau target
punya kunci, dan `NOT_LEADER` terlihat di status sehingga "Ambil kendali" bukan cabang mati.
Sisi stack hidup: `scripts/attack.ts` T12c/T12a/T12b — `leaderKey` 64 karakter dan tidak ada di
`wsPath`; 11 anggota × `tempo` → 11 `NOT_LEADER` dengan teks state pemimpin identik byte; 100×
`claim` tanpa `lk` → 100 `NOT_LEADER` dan bpm pemimpin tetap 118.

**Pagarnya dibaca per jendela, bukan per riwayat (ronde M3a #3).** Assertion claim di tes D
`eviction.spec.ts` dulu memakai `cari()`, yang memindai seluruh `frames` dari indeks 0, sementara baris
`tempo` di atasnya sudah memproduksi satu `NOT_LEADER` — jadi ia lulus tanpa pernah membaca jawaban claim.
Perbaikannya test-only (`a99a1a4`): jendela diambil dengan `sejak(dasar)` sesudah `tempo` ditolak, dan yang
dituntut adalah TEPAT SATU `error NOT_LEADER` (`:159-162`) plus NOL `state` (`:163-166`) di jendela itu.
(dua angka itu diukur di `a99a1a4`; di `f383335` assertion yang sama duduk di `:171-174` dan `:175-178` —
bergeser karena tes E ditulis di berkas yang sama, jadi yang salah label adalah angka lama kalau dibaca di
HEAD, bukan perilakunya.)
Gerbang mutasinya diukur di worktree `pc-exec-r3`, dua mutan yang tidak menyentuh verifikasi kripto dan
tidak memindahkan podium — M1 menyalahlabel kode jawaban di jalur tolak `claim`, M2 membuat jalur tolak itu
membocorkan satu siaran `state`:

```
M1 + D lama  → EXIT=0  4 passed (4)  2793ms   ← bukti pagar lama vacuous
M1 + D baru  → EXIT=1  1 failed | 3 passed (4)  5.29s
   AssertionError: claim tanpa lk harus dijawab TEPAT SATU NOT_LEADER,
   dapat [{"t":"error","code":"INTERNAL"}]: expected +0 to be 1   (eviction.spec.ts:162)
M2 + D baru  → EXIT=1  1 failed | 3 passed (4)  5.36s (D 1329ms)
   AssertionError: claim tanpa lk tidak boleh menyiarkan apa pun,
   dapat [{"t":"error","code":"NOT_LEADER"},{"t":"state","bpm":120,…,"members":2}]: expected 1 to be 0
M1 / M2 + session.spec.ts → 1 failed | 26 passed (27), keduanya tes yang sama:
   `claim dengan lk memindahkan podium, claim tanpa lk tidak menggeser apa pun` (:537)
   M1 jatuh di :553 (filter error kosong), M2 jatuh di :555 (frame-count leaders/anggota 5,4 ≠ 4,3)
   durasi session.spec.ts di bawah M2: 3.07s; di bawah M1: assertion [INTERNAL] ≠ [NOT_LEADER]
pulihkan SessionDO.ts → EXIT=0  4 passed (4)  tests 4037ms, Duration 5.31s
pulihkan + kedua berkas worker → EXIT=0  31 passed (31), Duration 5.46s
```

Angka itu bukan mutasi yang diminta pemeriksa via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T21:59:25.402Z (§5b: "buat `claim` menerima frame tanpa lk (fail-open)"): mutasi `claim` menerima frame tanpa `lk` (fail-open sungguhan)
**ditolak permission layer** dengan pesan `[Security Weaken]` dan penjelasan bahwa niat pengguna tidak bisa
membukanya, jadi pagar jalur claim pasca-evict hari ini terbukti mengikat pada dua mutan di atas, bukan pada
fail-open. Peta cakupannya tetap: jalur claim pra-evict dijaga `session.spec.ts:537`, jalur pasca-evict baru
dijaga D sejak `a99a1a4`.

**Dan checker pun tidak mengukur mutasi server di ronde #4 — ini harus ditulis, bukan disamarkan.** Pemeriksa
melaporkan bahwa edit mutasi mereka sendiri di `SessionDO.ts` kena hard-block classifier yang sama, jadi yang
mereka jalankan adalah **kontrol positif di tingkat assertion** (`pc-v4-pagar.cjs`, di worktree mereka, tidak
di-commit ke tree ini): pagar lama LULUS untuk ketiga kasus (vacuous, sama seperti M1 saya), dan pagar baru
MERAH untuk fail-open yang **disimulasikan** serta untuk M1. Labelnya SIMULASI dari mereka sendiri, dan angkanya
bukan hasil alat saya. Yang tidak boleh disimpulkan dari itu: bahwa fail-open `claim` sungguhan pernah diukur
siapa pun. Status itu tidak berubah sejak ronde #3, dan README bagian "BELUM di M3a" masih menulisnya apa adanya.

**Ronde M3a #4 — model (b) sekarang punya tes sendiri: E.** Lahir MERAH lebih dulu, sesuai B1, di atas
`0967b4e` sebelum satu baris kode produksi berubah (`73464b2`, `src/worker/eviction.spec.ts`, test-only):

```
npx vitest run --config vitest.worker.config.ts src/worker/eviction.spec.ts
EXIT=1   1 failed | 4 passed (5)   Duration 8.27s
  E — socket ber-did pemimpin tanpa lk tidak boleh memerintah, sebelum maupun sesudah evict
  AssertionError: fase 1 (sebelum evict): peniru ber-did sama tanpa lk harus DITOLAK, bukan dilayani,
  dapat [{"t":"state","bpm":177,"anchorMs":null,"running":false,"members":2}]:
  expected 'state' to be 'error'                                    eviction.spec.ts:220:7
```

Yang dituntut E, dan kenapa ia lebih kuat dari probe P3 pemeriksa: jawaban peniru harus `error` dengan
TEPAT SATU `NOT_LEADER` **dan** NOL `state` **di jendelanya sendiri**, lalu NOL `state` di jendela pemimpin
sah (bukan cuma "peniru ditolak", tapi "bpm 177 tidak pernah sampai ke SIAPA PUN"), fase itu diulang sesudah
`evictDurableObject`, kedua angka serangan (177, 188) tidak boleh muncul di riwayat kedua socket, dan ada dua
kontrol positif (`tempo 140` sebelum serangan, `tempo 199` sesudah dua penolakan) supaya implementasi
"semua orang ditolak" tidak bisa lulus. Hijau sesudah `f383335`, diukur ulang untuk ronde ini
(`npx vitest run --config vitest.worker.config.ts`, worktree utama):

```
EXIT=0   32 passed (32)   Duration 9.40s   (2 berkas: session.spec.ts 27, eviction.spec.ts 5)
  A 1367ms   B 1308ms   D 1296ms   E 1103ms          ← C tidak dicetak di daftar durasi itu
```

`session.spec.ts` tidak saya ubah sedikit pun: 27 tes itu sudah mendahului tiap perintah dengan `hello`
ber-`lk` (atau `claim` yang lulus), jadi (b) tidak memecahnya — itu dugaan pemeriksa, dan setelah dijalankan
ia benar. Yang TIDAK diukur oleh tes mana pun: layar. Setelah (b), HP yang memegang `did` pemimpin tanpa `lk`
masuk lewat cabang "Ambil kendali" di `ClickRoom.tsx` — dan cabang itu tidak pernah saya lihat di browser
dengan keadaan itu (`live.ts:94` membuat klien normal tidak masuk ke sana). Ditulis sebagai BELUM, bukan
sebagai selesai.
