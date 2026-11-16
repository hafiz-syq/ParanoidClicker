# ADR-0005: Otoritas pemimpin = kunci `lk` yang dicetak terpisah, rebut hanya lewat tombol

**Tanggal**: 2026-11-17 (= 2026-11-16T19:33:33.724Z dengan offset `-420`, jam `node -e
"console.log(new Date().toISOString(), new Date().getTimezoneOffset())"` saat dokumen ini diukur;
kode yang didokumentasikan diukur di `127.0.0.1:8787` pada 2026-11-16T19:09:46Z)
**Status**: accepted
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
keadaan tidak boleh bercabang. `hello` memverifikasi `lk` (`SessionDO.ts:141-143`) dan mengikat
`did` hanya kalau belum ada pemegang; tiga frame perintah dijaga `assertLeader(ws)` (`:198`, dipakai
di `:291` dan `:302`) yang bertanya ke **socket**, bukan ke `did` di dalam frame. Rebut kendali ada,
tapi hanya lewat frame `claim` yang membawa `lk` dan memverifikasinya ulang dari frame itu
(`:209-218`), dipicu tombol "Ambil kendali" (`ClickRoom.tsx:315-318`) yang muncul justru setelah server
menjawab `NOT_LEADER`.

**Yang dicabut dari kalimat di atas, dan kenapa.** Versi pertama ADR ini menulis bahwa identitas socket
"diambil dari `Map<WebSocket, {sid, did}>` hasil `hello` yang berhasil (`:113`)" — itu memang kode yang
lahir di `b9fc0f3`, dan kode itu cacat: `fetch()` memakai Hibernation API, jadi sesudah DO tidur
runtime memanggil handler dengan objek socket baru yang tidak ada di Map itu, dan pemimpin sah dijawab
`NOT_LEADER` bahkan lewat `claim` ber-`lk` yang benar. Nomor baris di paragraf di atas karena itu
diukur ulang di `a6ea775`, tempat identitas dibaca dari attachment socket lewat `peerOf()` (`:92-98`,
ditulis `remember()` di `:100-102` saat `hello` `:129`). Keputusan di ADR ini tidak berubah — otoritas
tetap `lk`, rebut tetap eksplisit — yang berubah hanya tempat kebenaran itu disimpan; itu ada di
[ADR-0007](0007-attachment-identitas-socket.md).

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

Yang dibandingkan adalah **`did`**, dan `did` diambil dari frame kiriman klien (`:107`; yang dijaga server
cuma panjang 1–32 karakter, tidak ada charset). Karena itu, sesudah satu `lk` pernah mengikat podium,
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
(`SessionDO.ts:144-153`), frame `state` tidak memuat `did` (`:251-257`), dan `grep -rn "\bdid\b" src/screens`
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

**Dua model yang tersedia, dan tidak satu pun saya pilih.** Kotak ini bukan keputusan saya — [TANYA]
pemilik, dua opsi disajikan apa adanya:

- **(a) Terima perilaku sekarang.** `did` yang cocok = boleh memerintah. Dikunci dengan tes permanen yang
  MENUNTUT `tempo 177` diterima di jendela socket ber-`did` sama tanpa `lk` — yaitu mengunci perilaku ini
  sebagai desain, supaya kalau nanti dibalik, yang berubah adalah tesnya dan perubahannya terlihat.
- **(b) Ikat otoritas pada flag di attachment** yang hanya ditulis ketika `verifyLeaderKey` lulus (di
  `hello` maupun `claim`), sehingga `assertLeader` menuntut flag itu DAN `leaderDid() === peer.did`. Socket
  tanpa `lk` tidak pernah boleh memerintah walau `did`-nya benar. Pemeriksa merekomendasikan (b) dan sudah
  mengukur bahwa jalan pulang pemimpin tidak terputus olehnya: `live.ts:94`
  `if (this.target.lk) hello.lk = this.target.lk;` mengirim `lk` di SETIAP `hello` selama target punya
  kunci, dan "Lanjut ke sesi" memulihkan `lk` dari `localStorage` — jadi reconnect pemimpin pasca-evict
  tetap bekerja.

Sampai ada jawaban, **tidak ada tes yang saya tulis untuk salah satu model**: tes untuk (a) mengunci
perilaku yang mungkin dibalik, dan tes untuk (b) hari ini masih merah. Probe yang menghasilkan angka P3 di
atas ada di worktree pemeriksa dan sengaja tidak di-commit ke tree ini.

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

Angka itu bukan mutasi yang diminta pemeriksa: mutasi `claim` menerima frame tanpa `lk` (fail-open sungguhan)
**ditolak permission layer** dengan pesan `[Security Weaken]` dan penjelasan bahwa niat pengguna tidak bisa
membukanya, jadi pagar jalur claim pasca-evict hari ini terbukti mengikat pada dua mutan di atas, bukan pada
fail-open. Peta cakupannya tetap: jalur claim pra-evict dijaga `session.spec.ts:537`, jalur pasca-evict baru
dijaga D sejak `a99a1a4`.
