# Rencana M3 — ParanoidClick: otoritas pemimpin di server

**Dibuat**: 2026-11-15 (setelah 26 Okt 2026 16:45 WIB, sesuai QODER.md:5)
**Direvisi**: 2026-11-15 — empat [TANYA] di §6 sudah dijawab pemilik; jawabannya dilipat ke §2–§4
**Direvisi**: 2026-11-16 — lihat **§8 KOREKSI**. Tiga atribusi pemilik di revisi 15/16 Nov memang
punya jawaban nyata, tapi tidak satu pun beralamat; sekarang tiap klaim di file ini menunjuk kunci
`S1`–`S7` di tabel alamat turn §8.2.
**Direvisi**: 2026-11-17 — juga §8 KOREKSI, ditulis ke depan (tanpa `amend`/`rebase`). Dua temuan
checker atas `1a30bba` **dia tarik sendiri** sesudah mengukur kanal `tool_result`; alamat S4 dan S6 di
§8.2 saya ganti dengan jam yang terukur sebagai field `timestamp` (S4 = 16:47:48.682Z, bukan
16:50:13.874Z), dan tafsir §6.2 ditutup sebagai **SELESAI (S7)** — socket mentah, keputusan pemilik 16
Nov atas jawaban 16 Nov yang lebih baru dari S2.
**Direvisi**: 2026-11-17 ronde M3a #3 — **§8.4** + kunci **`S8` [TANYA]**: pagar D sekarang dibaca per
jendela claim (`a99a1a4`), gerbang mutasi fail-open `claim` diblokir permission layer dan saya ukur dengan dua
mutan pengganti, dan model otoritas sesudah podium terikat (TEMUAN 4) belum dijawab — tidak saya putuskan
sendiri, tidak ada tes pengunci untuk salah satu opsi.
**Milestone**: M3 — "otoritas pemimpin di server" (`README.md:8`, `QODER.md:56`)
**Skill yang dipanggil untuk tahap ini** (`QODER.md:56`): `ecc:api-design`, `ecc:contract-first`,
`ecc:security-and-hardening`, `ecc:error-handling`
**Status kode**: kotak terakhir Baris persetujuan DIBUKA pemilik 2026-11-16T16:47:48.682Z (S4) → irisan §4
boleh ditulis, dimulai dengan tes yang GAGAL lebih dulu (B1, QODER.md:42). Sebelum jam itu tidak ada
satu baris `src/**` pun yang diubah, dan pemilik sudah menjawab (S1) *"Setuju, tapi jangan kode dulu"*.

---

## 1. Janji yang belum dibayar (semua bersaksi dari dalam repo)

- `SessionDO.ts:160-161` — komentar `shortcut:` yang ditulis M1b: *"siapa pun yang punya socket
  sesi boleh mengganti tempo, belum ada otoritas pemimpin. Ditutup di M3 (leader token + PIN
  join), bukan di sini."*
- `ClickRoom.tsx` — otoritas hari ini HANYA di sisi layar (`disabled={!leader}` pada
  ±tempo/Start/Stop/ramp). Socket pengikut yang mengirim `{t:'tempo'}` secara manual tetap
  dilayani server.
- `README.md` (status + M2 BELUM): *"Otoritas pemimpin masih di sisi layar saja → M3."*
- `README.md` (M1b BELUM): penghitung `N HP` adalah **riwayat orang yang pernah masuk**, bukan
  yang sedang terhubung, dan *"cara membaca angka itu diputuskan di M3 bersama otoritas pemimpin"*.
  → Jawabannya sudah ada (§6.2): socket hidup. Konsekuensinya di §4 butir 2c — angka itu dapat
  cara baru untuk basi, dan itu harus dibayar di M3a, bukan dibiarkan jadi regresi.

## 2. Fakta yang mengikat desain (sudah diverifikasi di tree ini, bukan diingat-ingat)

**Nomor baris di tabel ini membeku di tree 15/16 Nov SEBELUM M3a dan sengaja tidak disegarkan** — ia
adalah bukti audit pada saat keputusan diambil, bukan rujukan kode hari-hari. Setelah `b9fc0f3` dan
`a6ea775` yang berlaku adalah jangkar di README (tabel kontrak M3a) dan di ADR-0006/0007; misalnya
baris `SessionDO.ts:148` di bawah (siaran) sekarang `:266-270`, dan `:202-207` (`webSocketClose` yang
diam) sekarang `:325-337` dan sudah tidak diam.

| Fakta | Bukti | Konsekuensi |
|---|---|---|
| `tok` = HMAC(kunci, `sid`) — kapabilitas **sesi**, bukan kapabilitas **pemimpin** | `index.ts:36-37`, `index.ts:74-75` | token yang sama dipegang pemimpin dan kesebelas HP; `tok` TIDAK BISA menyatakan otoritas |
| `/create` hanya dipanggil browser pemimpin; pengikut masuk lewat URL join | `index.ts:66-75`, `main.tsx` (join → `role="follower"`), `Start.tsx:34` | ada persis satu jalur yang bisa menerima kunci tambahan tanpa mengubah tautan join |
| `hello` membawa `did` (≤32 char, dari localStorage) | `SessionDO.ts:68-70`, `live.ts:83`, `live.ts:269` | `did` cukup sebagai **identitas**, dan ia selamat dari reload/tab bangun |
| Kapasitas dan `members` dibaca dari `SELECT COUNT(*) FROM member` | `SessionDO.ts:76-77`, `:95`, `:137` | **diputuskan pindah ke socket hidup** (§6.2) — tiga tempat itu berubah MAKNA, tes di §4 ikut |
| Frame `hello` yang sama juga mengukur kuota tulis SQLite | `SessionDO.ts:82-88` (`INSERT OR IGNORE`), `:96` (`rowsWritten`) | tabel `member` TETAP ada: ia mengukur biaya tulis, bukan lagi menghitung kursi. Dua hal yang selama ini kebetulan memakai angka yang sama |
| `state` hanya disiarkan saat `hello` / `tempo` / `start` / `stop` | `SessionDO.ts:105`, `:156` (`apply` → `broadcast`) | dasar hitungan pindah ke socket = angka `N HP` bisa **lebih tinggi dari kenyataan** sampai frame berikutnya, karena `webSocketClose` (`:202-207`) tidak menyiarkan apa pun |
| Siaran lewat `this.ctx.getWebSockets()` | `SessionDO.ts:148` | jumlah socket hidup sudah bisa dibaca tanpa tabel baru — inilah yang dipilih |
| Klien lama menampilkan frame `error` apa pun sebagai `server menolak: <kode>` | `live.ts:232-234` (`String(frame.code)`, tanpa daftar kode) | kode `NOT_LEADER` terlihat di HP yang sudah ter-install **gratis**: tidak ada registrasi kode yang perlu diubah (lihat koreksi §4 butir 3) |
| `proto` = 2 | `index.ts:60-63` | **diputuskan tetap 2** (§6.1): `lk` jadi key opsional di `hello` |

## 3. Keputusan yang diterima (satu jalur, bukan menu)

**Otoritas = kunci pemimpin yang dicetak terpisah saat `/create`.**

- `/create` mencetak `lk = HMAC(kunci, sid + ":leader")` dan hanya mengirimnya di JSON `/create`.
  Tautan join / QR (`?sid=&tok=`) TIDAK memuat `lk`. Yang membagi tautan tetap cuma bisa jadi
  anggota.
- `hello` membawa `lk` (opsional — klien lama tidak mengirimnya dan masuk sebagai anggota,
  §6.1). DO memverifikasinya (`crypto.subtle.verify`, sama seperti `tok`) dan, kalau sah,
  mengikat `leaderDid = did` pada baris tunggal tabel `leader` (POLA sama dengan tabel `tempo`
  di `SessionDO.ts:21-23`: `CHECK(id = 1)` — keadaan tidak boleh bercabang).
- `tempo` / `start` / `stop` dari `did` selain `leaderDid` → `{t:'error', code:'NOT_LEADER'}`,
  keadaan sesi tidak tersentuh. Pemimpin yang reconnect dengan `did` yang sama (jalur
  **"Lanjut ke sesi"**, `Start.tsx:37-45` + `rememberTarget`) mendapat kendalinya kembali tanpa
  `/create` baru — ini jalur pemulihan, bukan jalur baru.
- **Rebut kendali (diterima, §6.3): ada, dan hanya sah dengan `lk`.** Layar pemimpin yang
  kehilangan podium — DO di-evict dan `leaderDid` terikat ke `did` lama yang HP-nya sudah mati —
  menekan "Ambil kendali"; DO memverifikasi ULANG `lk` dari socket itu sendiri (tidak percaya
  hasil `hello`) lalu mengganti `leaderDid` dan menyiarkan `state`. Yang tidak punya `lk`
  mendapat `NOT_LEADER`. Ini bukan pintu baru: `lk` sudah satu-satunya bukti pemimpin, dan
  tombolnya hanya bisa dipakai orang yang memegang kunci yang sama.
- Alternatif yang saya **tolak**: (a) klaim-pertama-datang (siapa pun yang membuka tautan lebih
  cepat jadi diktator, dan setelah DO eviksi orang asing bisa jadi pemimpin); (b) PIN join
  (pantas hidup di M4 bersama QR, bukan sekarang); (c) otoritas tanpa kunci (server tidak bisa
  membedakan pemimpin dari pengikut — itu justru intinya); (d) rebut otomatis tanpa tombol
  (podium pindah diam-diam di tengah lagu lebih buruk daripada tanpa pemimpin sama sekali,
  karena sebelas HP tidak tahu siapa yang megang).

## 4. Dampak + telaah cakupan — setiap tempat yang harus disentuh

**Kode produksi**
1. `src/worker/index.ts` — `/create` mengembalikan `{sid, token, leaderKey, wsPath}`. Rute `/ws`
   tidak berubah (verifikasi `tok` tetap gerbang masuk ruangan).
2. `src/worker/SessionDO.ts` —
   **2a.** tabel `leader` (DDL di §5), `hello` mengikat pemimpin, penjaga `assertLeader(did)` di
   tiga frame perintah, frame baru `{t:'claim'}` untuk rebut kendali;
   **2b.** kapasitas + `members` dibaca dari **socket hidup**, bukan `SELECT COUNT(*)`: `:76-77`
   (gerbang `FULL`), `:95` (`members` di `welcome` — ekspresi `known ? total : total + 1` hilang,
   karena socket yang baru masuk sudah terhitung sendiri), `:137` (`members` di `state`);
   **2c.** `webSocketClose` `:202-207` menyiarkan `state` supaya kursi yang baru kosong tidak
   menunggu frame berikutnya.

   **Tafsir §6.2 — SELESAI (S7).** Yang jadi dasar kode hari ini: **jumlah socket hidup MENTAH** dari
   `getWebSockets()` — itu bunyi harfiah jawaban 15 Nov (S1), dan itu yang dikerjakan (S6). Riwayat
   lengkapnya, supaya tidak dibaca sebagai kontradiksi: (a) 15 Nov 18:46Z sesi saya mencatat pemilik
   memilih label opsi *"did unik di antara socket hidup"* (S2). (b) 16 Nov 16:51Z prompt checker
   menyatakan pertanyaan itu belum dijawab (S6b) — **framing checker yang salah, dan dia menariknya**:
   jawaban S2 mendarat sebagai `tool_result` sehingga tidak muncul di daftar turn yang dia baca; dua
   tuduhan lain dari prompt yang sama juga dia cabut (README §KOREKSI 2026-11-16/17). (c) Setelah kedua
   jawaban lama ditampilkan apa adanya, pemilik **mengganti pilihannya sendiri** (S7): "Socket mentah",
   lalu — sesudah konsekuensi 2-kursi dibacakan ulang ke dia — "Tetap socket mentah". Urutan 15 Nov →
   16 Nov ini sah, bukan pertengkaran: yang ditanya 16 Nov adalah pertanyaan yang diformulasikan ulang,
   dan yang membatalkan label 15 Nov adalah pemilik sendiri (S7) — bukan saya dan bukan checker.
   Karena itu butir 2b–2c selesai dan benar apa adanya: **kode tidak diubah, tidak ada dedupe `did`,
   tidak ada tes yang pindah angka** — `session.spec.ts:149` tetap menuntut `members: 13`. Kalau suatu
   hari keputusan ini dibuka lagi, dua tempat yang bergerak: gerbang `FULL` (`:76-77`) dan `members` di
   `welcome` (`:95`), plus assertion itu.
   Konsekuensi yang diterima bersama jawabannya (S7) tetap tertulis keras dan TIDAK boleh dilunakkan
   jadi "aman": dengan socket mentah, satu HP yang network-nya flap atau reload sebelum socket lama
   terdeteksi tutup memakan **2 kursi**, jadi ruangan 12 bisa menjawab `FULL` dengan 11 HP nyata di
   tengah latihan. Tidak ada penahan untuk itu di M3a — yang ada cuma siaran `state` di `webSocketClose`
   (butir 2c) yang membuat angkanya bisa turun sendiri.
3. `src/shared/limits.ts` — **TIDAK disentuh.** Butir ini saya tulis salah di versi pertama
   rencana ini: `FrameCode` (`limits.ts:7`) adalah daftar penolakan *bentuk frame*
   (`TOO_BIG`/`TOO_DEEP`/`BAD_KEY`/`BAD_TYPE`), bukan daftar kode error di wire. Kode wire
   (`PROTO` di `:62,71,195`, `FULL` di `:79`, `BAD_BPM` di `:167`) memang literal di
   `SessionDO.ts` dan tidak pernah diregistrasi di mana pun; `live.ts:233` mencetak apa pun yang
   datang. Jadi `NOT_LEADER` tidak butuh perubahan di `src/shared/`.
4. `src/app/session/live.ts` — `LiveTarget` dapat `lk?` opsional; `hello` mengirimnya kalau ada;
   `rememberTarget` menyimpannya (kalau tidak, pemimpin yang layarnya mati kehilangan podium).
5. `src/screens/Start.tsx` + `src/main.tsx` — ~~`lk` mengalir dari JSON `/create` ke `ClickRoom`
   lewat target, BUKAN lewat URL~~ → **TIDAK disentuh, dan butir ini memang salah nama berkas.**
   Dikoreksi 2026-11-17 atas temuan checker (ronde M3a #2 butir 3b), diukur dulu:
   `git log --oneline 452488c..HEAD -- src/screens/Start.tsx src/main.tsx` → **kosong**, dan
   `git log --oneline -1 --` masing-masing berhenti di `e44f96f` (2026-11-15T10:18:38+07:00), yang
   dua-duanya sudah leluhur `452488c` (`git merge-base --is-ancestor` → YA untuk keduanya).
   Alasannya sederhana dan itu yang harusnya ditulis sejak awal: `fetch('/create')` **sudah hidup
   di `ClickRoom.tsx` sebelum M3a sama sekali** — di `452488c` ia baris `:127`, dan
   `git log -S"'/create'" -- src/screens/ClickRoom.tsx` menunjuk kelahirannya ke `6259a7e`
   (M1b, `:121` di commit itu; sekarang `:144`, bergeser karena b9fc0f3). `lk` ikut mengalir tanpa
   menyentuh dua berkas itu karena ia naik di dalam objek yang sudah lewat: `ClickRoom.tsx:153-154`
   menyusun `LiveTarget` dengan `lk` → `:109` `rememberTarget(t, …)` → `Start.tsx:40` mengirim
   seluruh `remembered` ke `setView` → `Start.tsx:17` `<ClickRoom … target={view.target} />`.
   `main.tsx:17` memang sengaja tidak berubah: jalur URL-nya pengikut, dan di sana `lk` tidak boleh
   ada (URL = tautan join = kunci sesi `tok` saja).
   Yang tetap benar dari butir ini cuma setengah belakangnya: `lk` mengalir lewat target, BUKAN
   lewat URL — dan itu sekarang dijaga `T12c` di `scripts/attack.ts` ("leaderKey 64 karakter,
   tidak ada di wsPath").
6. `src/screens/ClickRoom.tsx` — `leader` bukan lagi sekadar peran UI: jadi
   *"punya lk DAN server mengakui did-ku"*. Tombol pengikut tetap disabled; pemimpin yang
   menerima `NOT_LEADER` melihat statusnya plus tombol "Ambil kendali", bukan bisu.

**Perubahan kontrak yang harus disebut sebelum kode ditulis** (sesuai syarat checker):
isi frame `state` tidak bertambah dan tidak berkurang — `bpm`, `anchorMs`, `running`, `members`
seperti sekarang — TAPI arti `members` berubah (riwayat → kursi hidup), dan `state` mulai
disiarkan pada `webSocketClose`, sesuatu yang tidak pernah terjadi sebelumnya. Klien lama tetap
baca angka itu sebagai "N HP"; hanya angkanya bisa TURUN, dan itu justru yang dijanjikan M1b.
Frame masuk baru (`claim`) adalah penambahan kontrak, dan karena `lk` opsional, `proto` tetap 2.

**Test yang berubah atau lahir** (semuanya ditulis GAGAL dulu, sesuai `QODER.md:42`)
- `src/worker/session.spec.ts` (+5): pengikut kirim `tempo` → `NOT_LEADER` dan `bpm`/`anchor`
  **tidak berubah**; pemimpin kirim → lahir; reconnect pemimpin dengan `did` sama → masih
  pemimpin; dua HP berbeda sama-sama bawa `lk` sah → yang pertama mengikat, yang kedua
  `NOT_LEADER`; `claim` dengan `lk` sah → `leaderDid` pindah + `state` disiarkan, sedangkan
  `claim` tanpa `lk` → `NOT_LEADER` dan `leaderDid` tidak berubah.
- `src/worker/session.spec.ts` — **yang berubah MAKNA karena §6.2, bukan sekadar angka.**
  Daftarnya dari `grep -n "members\|FULL"` di tree ini (bukan dari ingatan):
  `hello ke-13 dari device baru ditolak FULL` (`:107-124`) — kursinya sekarang socket hidup,
  jadi tes harus menutup socket supaya 12 kursi itu nyata; `orang ke-13 ditolak FULL tanpa
  membuat hitungan HP jadi 13` (`:264-286`) — kesimpulannya tetap benar, tapi alasannya di
  komentar `:132-136` ("yang ditolak FULL tidak boleh menambah satu HP hantu") pindah dari SQL
  ke socket; assertion angka `members` di `:88`, `:102`, `:104`, `:216-218`, `:229`, `:238`,
  `:257`, `:309` — dibaca ulang satu-satu, jangan diganti buta. Tes reconnect `:97-104`
  (`rowsWritten: 0`) tetap sah karena tabel `member` tidak dihapus.
- `src/worker/session.spec.ts` (+1): socket ditutup → `state` terbaru berisi jumlah kursi yang
  sudah turun (bayaran untuk butir 2c; tanpa tes ini jalur itu jadi cabang tak teruji).
- `src/app/session/live.spec.ts` (+2): `hello` membawa `lk` kalau pemimpin dan tidak membawa
  kalau pengikut; `onStatus` menampilkan penolakan `NOT_LEADER` dan "Ambil kendali" tidak jadi
  cabang mati (`QODER.md:40`).
- `scripts/attack.ts`: kasus baru — 12 socket anggota mengirim `tempo` bergantian; keadaan sesi
  tidak boleh berubah satu byte pun dan `state` tidak boleh disiarkan. Plus `claim` tanpa `lk`
  100×: `leaderDid` tidak boleh goyah.
- Yang TIDAK lahir: tes `limits.spec.ts` untuk kode baru — tidak ada daftar kode yang perlu
  ditambah (lihat koreksi butir 3).

**Dokumentasi** — README bagian M3 (angka mentah, bukan prosa), ADR-0005 untuk kunci pemimpin +
rebut kendali (keputusan arsitektur: ada alternatif yang ditolak dan ada konsekuensi), ADR-0006
untuk dasar hitungan `N HP` (ia mengubah janji yang ditulis di M1b), `docs/adr/README.md`.

**Keluar dari M3a (§6.4)**: setlist — tabel, layar, dan frame-nya sendiri jadi M3b. Tidak ada
satu pun butir di atas yang bergantung padanya.

**Yang TIDAK disentuh**: `bukti/`, `.dev.vars`, kunci produksi, tidak ada deploy, tidak ada push,
tidak ada dependensi baru, `proto` tetap 2.

## 5. Skema lokal dulu (perintah DDL, TIDAK dijalankan ke produksi)

```sql
CREATE TABLE IF NOT EXISTS leader (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  did TEXT NOT NULL,
  lk_hint TEXT,
  claimed_at INTEGER NOT NULL
);
```

`lk_hint` = 8 karakter hex pertama dari `lk` — cukup untuk menampilkan "pemimpin sekarang memakai
kunci yang mana" di diagnostics kalau ada rebut yang misterius, dan tidak cukup untuk merebut
apa pun. Kolom ini lahir dari pilihan rebut eksplisit (§6.3): tanpa jejak, rebut yang salah sulit
dibuktikan dari layar.

Dibuat dan diverifikasi di `wrangler dev --local` (SQLite DO lokal) + tes worker. Migrasi ke
produksi = keputusan terpisah, dan `CREATE TABLE IF NOT EXISTS` dipilih supaya sesi yang sudah
hidup tidak perlu dihancurkan.

## 6. Empat [TANYA] — sudah dijawab pemilik, 2026-11-15

| # | Pertanyaan | Jawaban pemilik (S1) | Jadi di rencana |
|---|---|---|---|
| 1 | Perlu `proto` naik 3? | **"Setuju, tapi jangan kode dulu"** | `proto` tetap 2, `lk` key opsional di `hello`; dan TIDAK ada satu baris kode pun ditulis sebelum kotak terakhir Baris persetujuan dicentang |
| 2 | Dasar kapasitas 12 HP: socket hidup atau riwayat? — **dan pertanyaan bernama yang sempat tersisa: socket mentah atau per `did` unik?** | **"Socket hidup (getWebSockets)"** (S1) sebagai jawaban pertama. Tafsirnya **SELESAI (S7)**: label *"did unik di antara socket hidup"* pernah pemilik pilih (S2 15 Nov), lalu dia ganti sendiri jadi **"Socket mentah"** (S7 16 Nov 16:57Z) dan menegaskannya ulang sesudah konsekuensi 2-kursi dibacakan (S7 20:36Z). Arahan checker 16 Nov yang menyatakan itu belum dijawab adalah framing yang salah dan sudah checker tarik | §4 butir 2b–2c; tabel `member` tetap untuk `rowsWritten`; gerbang `FULL` + `members` di `welcome` TIDAK berubah dan tidak ada tes yang pindah angka |
| 3 | Rebut pemimpin: boleh? | **"Rebut dengan lk, eksplisit"** | §3 butir rebut + frame `claim` (§4 butir 2a) + 2 tes baru + kolom `lk_hint` di §5 |
| 4 | Setlist di M3 atau dipecah? | **"M3b terpisah"** | §4 "Keluar dari M3a" |

## 7. Gerbang sebelum commit apa pun boleh disebut selesai

- Test ditulis GAGAL lebih dulu; RED difoto dan dikutip di pesan commit (angka, bukan "sudah
  gagal").
- `npm run check` hijau (typecheck, `lint:arch`, unit, worker).
- `npm run attack` hijau di worker lokal, termasuk kasus `NOT_LEADER` dan `claim`.
- Ukur di stack hidup, DUA perangkat: pengikut yang memaksa `tempo` lewat socket → `NOT_LEADER`,
  `bpm` dan `anchor` kedua layar tetap identik, `0 hilang` tidak berubah, dan angka `N HP`
  TURUN ketika satu perangkat ditutup (ini tes baru yang lahir dari §6.2 — tanpa servo dan tanpa
  otoritas, angka itu tidak boleh berubah sendiri).
- Tidak di-push, tidak di-deploy.

---

## Baris persetujuan

Pemilik sudah membaca rencana ini; jawabannya (S1) dicatat apa adanya (2026-11-15):

- [x] **§3 kunci pemimpin (`lk` dari `/create`, tidak lewat tautan join)** sebagai desain M3a — *"Setuju"*
- [x] **§6.1** `proto` tetap 2, `lk` opsional di `hello` — *"Setuju"*
- [x] **§6.2** dasar kapasitas: **socket hidup (`getWebSockets`)** — jawaban pemilik 15 Nov (S1) yang
      nyata (S1, sudah masuk commit `34e234c`). Kotak ini TETAP `[x]` untuk isi itu. Yang dicabut
      cuma frasa tambahan "dan ditafsirkan per `did` unik ketika ditanya ulang 2026-11-16" — tafsir
      itu **SELESAI (S7)**: pemilik sendiri menggantinya dengan "Socket mentah" 16 Nov 2026, dua kali.
      Tidak ada `[TANYA]` yang tersisa di butir ini; riwayatnya di §4 butir 2b dan §8.2.
- [x] **§6.3** rebut pemimpin: **dengan `lk`, eksplisit** (tombol "Ambil kendali")
- [x] **§6.4** setlist dipecah ke **M3b** (M3a saja dulu)
- [x] **Boleh menyentuh `src/worker/**` dan `src/app/**`** untuk irisan yang tercantum di §4 —
  DIBUKA pemilik 2026-11-16 23:47 WIB, kata kerjanya "lanjutkan ke tahap selanjutnya", sumber
  via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:47:48.682Z (S4). Kanal jawabannya sesi
  checker, dirolay ke saya lewat prompt — bukan turn di sesi ini, dan itu sebabnya penanda sumbernya
  menunjuk sesi lain. Alamat lama baris ini (`…@2026-11-16T16:50:13.874Z`, dan bentuk pendek
  `2d6f4ca7@…` yang tidak lolos regex penjaga) salah dan dicabut di §8.2, bukan dihapus diam-diam.
  Yang tetap berlaku: ini satu-satunya kotak yang pemilik buka hari itu (S6b).
  **Kalimat cakupan di baris ini dibetulkan 2026-11-17 atas perintah checker ronde M3a #2 butir 3a**
  — ini koreksi teks, bukan jawaban baru dan bukan pelebaran izin. Glob `src/worker/**` + `src/app/**`
  lebih sempit dari yang sungguh disentuh M3a: `git show --stat b9fc0f3` mencetak
  `src/screens/ClickRoom.tsx | 69 +++++++++++++++++---` dan `scripts/attack.ts | 17 +++++-`, dan pada
  range `452488c..HEAD` (`git diff --stat`) keduanya 69 dan 142 baris. Keduanya tidak masuk diam-diam:
  `src/screens/ClickRoom.tsx` disebut namanya di §4 butir 6, `scripts/attack.ts` disebut namanya di
  daftar "Test yang berubah atau lahir" §4, dan dua daftar itu adalah isi rencana yang dibaca saat S4
  dibuka. Bentuk kalimat yang benar untuk kotak ini karena itu: *"untuk irisan yang tercantum di §4 —
  termasuk berkas yang §4 sebut namanya di luar dua glob itu (`src/screens/ClickRoom.tsx`,
  `scripts/attack.ts`, `src/worker/*.spec.ts`)"*. Baris tanda tangan di bawah tetap tidak saya sentuh.
  Kalau pelebaran glob secara resmi (bukan hanya kalimat) memang diminta, itu pertanyaan untuk pemilik
  dan saya tandai [TANYA] — tidak saya jawab sendiri.

Persetujuan pemilik (kotak terakhir, yang membuka kode): `________________________`  Tanggal: `____________` — [TANYA]: baris ini hanya boleh diisi tangan pemilik; jawaban S4 saya catat di baris di atas, bukan di sini.

Kotak terakhir dibuka (S4), jadi urutan yang berlaku sekarang: tes GAGAL lebih dulu (B1, QODER.md:42)
→ kode §4 (B2) → dokumen + ADR-0005/0006 (B3). Yang tetap tidak: deploy, push, dan tulis apa pun ke
produksi (S5).

---

## 8. KOREKSI — atribusi pemilik yang tidak beralamat

Ditulis 2026-11-17 00:07 WIB = 2026-11-16T17:07Z (`node -e "console.log(new Date().toISOString(), new Date().getTimezoneOffset())"`
→ `2026-11-16T17:07:26.175Z -420`; `-420` = WIB, dan jamnya bergerak setiap dijalankan — yang
tetap cuma offset). Commit yang dikoreksi: `1a30bba` (2026-11-16 01:50 WIB = 2026-11-15T18:50Z).
History TIDAK di-`amend`/`rebase` — dua sesi berbagi satu tree, dan commit itu adalah satu-satunya
jejak lokal.

### 8.1 Tiga kalimat lama, dan apa yang sebenarnya salah

Kalimat lama (dipetik dari diff `1a30bba`, bukan dari ingatan):

```
**Tafsir §6.2 — DIKONFIRMASI pemilik, 2026-11-16**: yang dihitung adalah **`did` berbeda di
antara socket hidup**, ... Konsekuensi yang sekarang resmi: satu orang dengan dua tab terhitung SATU kursi

| 2 | Dasar kapasitas 12 HP: socket hidup atau riwayat? | **"Socket hidup (getWebSockets)"**, dan
ditafsirkan **per `did` unik** ketika ditanya ulang 2026-11-16 | ...

- [ ] **Boleh menyentuh `src/worker/**` dan `src/app/**`** ...
  **DITANYA ULANG 2026-11-16, jawaban pemilik tetap: "Tahan dulu, tetap docs-only"**

**Keputusan pemilik 2026-11-16: `@types/node` jangan dipasang, tunda.**   (README.md:501)
```

Yang salah bukan *isi* jawabannya. Yang salah tiga hal lain — **catatan 2026-11-17: checker menarik
dua dari tiga tuduhan** yang lahir dari temuan ini, yaitu yang "tidak ada yang pernah menjawab" dan
yang "satu kotak `[ ]` → `[x]` tanpa ada yang mencentang", setelah dia mengukur kanal `tool_result` di
transkripnya sendiri. Angka dan alamatnya ada di README §KOREKSI 2026-11-16/17; yang tersisa cuma butir
1 dan 2 di bawah, dan itu cacat bentuk yang nyata (S6a).

1. **Tidak ada alamat.** Tidak ada `sessionId`, tidak ada timestamp, tidak ada kanal. Sesi checker
   mencari turn pemilik dengan `read_chat_session` pada sesi ini, tidak menemukannya, lalu menyimpulkan
   attribusinya fiktif (S6a) — kesimpulan yang sudah dia tarik, tapi masuk akal kalau hanya daftar turn
   itu yang dilihat.
2. **Kanal jawaban tidak pernah ditulis.** Empat dari lima keputusan pemilik di file ini (S1 dan S2)
   datang lewat **AskUserQuestion**, yang tercatat sebagai `tool_result`, bukan sebagai turn chat.
   Jadi "tidak ada turn pemilik di jam itu" dan "pemilik menjawab" (S1/S2) keduanya benar — yang hilang
   cuma keterangan bahwa jawabannya tidak lewat turn chat. Ini buta-ruang alat, bukan bohong penulis.
3. **Kutipan yang saya cetak adalah LABEL OPSI yang saya tulis sendiri**, bukan kalimat yang pemilik
   ketik. Yang dari pemilik adalah **pilihannya**. "Setuju, tapi jangan kode dulu", "Tahan dulu, tetap
   docs-only", "did unik di antara socket hidup", "Jangan pasang, tunda" — empat-empatnya frasa saya.
   Penanda `S1`/`S2` di bawah menyatakan kanal ini setiap kali, dan tidak ada satu pun yang saya tulis
   ulang sebagai kalimat pemilik.

Yang saya pertahankan dari `1a30bba`: ketiga keputusan itu **nyata dan terdokumentasi di log sesi ini**
(`S1`, `S2`). Kotak §6.2 tidak pernah saya ubah dari `[ ]` ke `[x]` di commit itu — ukur sendiri,
dijalankan 2026-11-17:

```
$ for r in 34e234c eaf5e63 1a30bba 452488c 178e1e9 b9fc0f3 33c2342; do printf '%s  [x]=' $r; git show $r:docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md | grep -c '^- \[x\]' | tr -d '\n'; printf '  [ ]='; git show $r:docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md | grep -c '^- \[ \]'; done; printf 'worktree  [x]='; grep -c '^- \[x\]' docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md | tr -d '\n'; printf '  [ ]='; grep -c '^- \[ \]' docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md
34e234c  [x]=5  [ ]=1
eaf5e63  [x]=5  [ ]=1
1a30bba  [x]=5  [ ]=1
452488c  [x]=5  [ ]=1
178e1e9  [x]=6  [ ]=1
b9fc0f3  [x]=6  [ ]=1
33c2342  [x]=6  [ ]=1
worktree  [x]=6  [ ]=1
```

Angka `6` **sudah masuk commit** — dan ini mengoreksi kalimat saya sendiri di versi rencana ini
sebelumnya, yang menulis "`6` di worktree, belum ada di commit mana pun". Yang memindahkan kotak kode
dari `[ ]` ke `[x]` adalah `178e1e9` (tes RED, 2026-11-16T18:18:19Z), yaitu commit pertama sesudah
jawaban pemilik S4 membuka kotak itu — bukan commit dokumen ini, dan bukan `1a30bba` (S4).

Sisa satu `[ ]` di worktree itu bukan kotak aktif: barisnya hidup di dalam blok kutipan §8.1 di atas
(kutipan teks lama yang sedang dikoreksi), jadi `grep -n "^- \[ \]"` menunjuk ke dalam pagar ```.

### 8.2 Tabel alamat turn (penanda `S1`–`S8`)

Cara membaca: buka sesi itu di Qoder, gulir ke menit timestamp-nya. **Cara verifikasi berubah 2026-11-17
dan itu mencabut catatan lama di sini:** kalimat lama di bagian ini ("`scripts/gerbang.spec.ts` cuma
bisa memeriksa BEN-TUK alamat karena `~/.qoder/projects/*.jsonl` diblokir untuk dibaca") hanya benar
sebagian — yang diblokir
adalah mem-parse berkasnya dengan `node`, sedangkan Grep atas pola `"timestamp":"…"` jalan. Jadi tiap
jam di tabel ini saya cek sebagai **field `timestamp` asli** pada rekaman ber-`uuid`, bukan sebagai angka
yang dikutip di dalam isi pesan, dan kolom Kanal menyebut `type` rekamannya (`assistant`/`user` +
`tool_result`). Dua konsekuensi langsung: (a) bentuk pendek `via 2d6f4ca7@…` yang checker pakai di
promptnya memang tidak lolos `P_VIA` dan itu bukan salah penjaganya — dokumen ini pakai UUID penuh +
detik; (b) `2026-11-16T16:50:13.874Z` dan `2026-11-16T17:32:47Z` nol kecocokan sebagai field di kedua
transkrip — keduanya output `node -e` yang dikutip di dalam isi pesan (jam mesin checker 60 ms sebelum
rekaman `16:50:13.934Z`; jam sesi saya, cetakan `17:32:47.248Z`, di rekaman `17:32:47.356Z`), sehingga
keduanya dicabut sebagai alamat dan digantikan jam kirim/jam jawab yang terukur.
Penjaga bentuk di `scripts/gerbang.spec.ts` tetap tidak membuktikan ISI jawaban — itu tetap kerja mata
manusia di App — tapi sekarang bisa ditunjuk: uuid rekamannya ada di kolom Kanal.

| Kunci | Isi | Alamat | Kanal |
|---|---|---|---|
| S1 | empat jawaban §6: "Setuju, tapi jangan kode dulu" · "Socket hidup (getWebSockets)" · "Rebut dengan lk, eksplisit" · "M3b terpisah" | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T09:16:14.324Z | AskUserQuestion (pemilik memilih label yang saya tulis) |
| S2 | tiga jawaban: "Tahan dulu, tetap docs-only" · "did unik di antara socket hidup" (label ini **dibatalkan pemilik sendiri 16 Nov**, lihat S7) · "Jangan pasang, tunda" (`@types/node`) | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:46:12.942Z | AskUserQuestion → rekaman `type: user` dengan `content[0].type = "tool_result"`, uuid `63c06fb6-462f-40b4-981d-0e4cfb7e6fec`; pertanyaannya dikirim 18:44:44.543Z dan panggilan pertama gagal parse (`Error: JSON_PARSE`) — jam kegagalan itu muncul sebagai dua rekaman bertetangga, `18:44:35.788Z` dan `18:44:35.891Z`, selisih 103 ms, keduanya field asli |
| S3 | perintah pemisahan logo: **"logo WEB pakai mark baru ini; logo APLIKASI tetap pakai yang lama."** | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:51:40Z | turn `CHECKER → EXECUTOR` di sesi ini; jamnya **dilaporkan** sesi checker (2d6f4ca7), saya tidak mengukur ulang; kutipannya kata pemilik yang dipetik checker, bukan kata saya |
| S4 | jawaban pemilik dua pertanyaan di sesi checker: **kotak kode M3a DIBUKA** ("lanjutkan ke tahap selanjutnya") + **`apple-touch-icon` = permukaan APLIKASI**, tetap `paranoid-180.png` | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:47:48.682Z | pemilik menjawab di sesi checker 23:47 WIB; rekaman `type: user` + `tool_result`, uuid `4713e8f8-5888-4b7d-9bd6-b721428b834a` (baris 2720 transkrip checker). Isinya sampai ke saya **dirolay prompt checker**, bukan sebagai turn di sesi ini. Rewrite 16 Nov 17:07Z menulis baris ini sebagai "[TANYA] — belum sampai"; prompt berikutnya membawanya, jadi statusnya berubah jadi DIJAWAB dengan kanal relay. **Alamat lama baris ini (`16:50:13.874Z`) salah dan checker mengakuinya:** itu output `node -e` di pesannya sendiri 2 m 25 d sesudah jawaban, nol kecocokan sebagai field `timestamp` |
| S5 | aturan berdiri: `JANGAN deploy`, `JANGAN push`, "tulis apa pun ke produksi butuh izin eksplisit pemilik", larangan skill `vercel-deploy`, larangan commit `tail*.log` | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:38:43Z | turn `CHECKER → EXECUTOR` yang memetik aturan pemilik; jamnya dilaporkan sesi checker, saya tidak mengukur ulang |
| S6 | tiga prompt checker: (a) temuan provenance atas `1a30bba` + tuntutan assertion penjaga, (b) arahan M3a B0–B4 termasuk **`scripts/gerbang-ikon.mjs` jangan disentuh**, (c) tambahan soal §6.2 | (a) via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:33:23.589Z · (b) via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:51:22.707Z · (c) via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:58:04.311Z | jam **kirim** di transkrip checker, diukur sebagai field `timestamp` rekaman `type: assistant` (baris 2690-2692, 2732-2734, 2785-2786). (a) mendarat di sesi saya 10 detik kemudian (turn delegasi `16:33:33.483Z`). **Alamat lama `…@2026-11-16T17:32:47Z` dan `[TANYA]`-nya dicabut:** jam itu hasil `node -e` di mesin saya saat membaca prompt dan tidak ada sebagai field di transkrip mana pun. Isi (b) dan (c) yang menyebut "pemilik tidak menjawab tafsir §6.2" juga ditarik checker — lihat S7 |
| S7 | jawaban pemilik atas tafsir §6.2 di sesi checker: **"Socket mentah"**, lalu setelah kedua jawaban lama (S1/S2) ditampilkan padanya, **"Tetap socket mentah"** | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:57:02.999Z · via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T20:36:32.241Z | rekaman `type: user` + `tool_result` (AskUserQuestion di sesi checker), uuid `0967ee46-533c-448f-b4bf-1023bdf7566d` (baris 2773) dan `efad1bdd-6a28-4a4f-a6ba-134242068698` (baris 2951). Urutannya penting: 16:47:48 (S4) → 16:50:13 checker cetak jam → 16:51:22 prompt (b) → **16:57:02 jawaban ini** → 16:58:04 prompt (c) → 20:36:32 penegasan ulang. Jadi prompt (b) dan (c) sama-sama menulis "belum dijawab" padahal jawabannya sudah ada 6 menit sebelumnya |
| S8 | pertanyaan ronde M3a #3 yang **belum dijawab dan tidak saya jawab sendiri**: model otoritas sesudah podium terikat — (a) terima perilaku hari ini (`did` yang cocok = boleh memerintah) dan kunci dengan tes, atau (b) ikat otoritas pada flag di attachment yang hanya ditulis ketika `verifyLeaderKey` lulus, sehingga `assertLeader` menuntut flag itu DAN `leaderDid() === peer.did` | [TANYA] | pemeriksa merekomendasikan (b) dan mengukur bahwa reconnect pemimpin tidak putus olehnya (`live.ts:94` mengirim `lk` di tiap `hello` selama target punya kunci; "Lanjut ke sesi" memulihkannya dari `localStorage`). Dua opsi ditulis apa adanya di ADR-0005 bagian "Batas yang terukur di ronde M3a #3" dan di §8.4 di bawah. Tidak ada tes yang saya tulis untuk salah satunya sampai ada jawaban |

Konsekuensi `S2` yang bukan jawaban: "satu orang dua tab = satu kursi" adalah entailment saya dari
label `did` unik + `did` per-browser (`live.ts:269`), jadi dia ditulis sebagai *konsekuensi-if-ya* di
§4 butir 2b, bukan sebagai "keputusan resmi". Setelah S7 entailment itu tidak berlaku lagi: yang berlaku
justru kebalikannya — dua tab = **dua kursi** — dan itu tertulis sebagai harga yang diterima.

Konsekuensi `S2` yang **tidak jadi saya kerjakan, dan sekarang resmi bukan pekerjaan**: prompt checker
2026-11-16 (S6b, S6c) menyatakan pemilik tidak menjawab tafsir `did` unik — pernyataan yang checker
tarik sendiri, karena jawaban S2 nyata ada dan hanya tidak kelihatan di daftar turn (kanalnya
`tool_result`). Hasil akhirnya tetap sama, tapi bukan karena prompt itu: yang menggantinya jawaban yang
lebih baru dari pemilik sendiri (S7) — "Socket mentah" 16:57Z lalu "Tetap socket mentah" 20:36Z. Kode
`b9fc0f3` mengikuti S7 dan benar apa adanya: tidak ada dedupe `did`, `session.spec.ts:149` tetap menuntut
`members: 13`, tidak ada tes yang pindah angka. Baris S2 di atas tetap tertulis sebagai riwayat pilihan
15 Nov (S2) yang dibatalkan pemilik sendiri — bukan sebagai konflik yang menggantung, dan bukan sebagai
sesuatu yang saya hapus karena sudah tidak cocok. Yang tidak saya lunakkan: konsekuensi **2 kursi untuk
satu HP yang flap atau reload** tetap berdiri di §4 butir 2b dan di ADR-0006, lengkap dengan `FULL`
palsu di ruangan 12 HP yang sedang latihan.

Satu jawaban S4 lagi yang menyentuh dokumen, bukan kode: **`apple-touch-icon` digolongkan permukaan
APLIKASI**, jadi `index.html` tetap menunjuk `paranoid-180.png` dan `scripts/gerbang-ikon.mjs` **tidak
diubah** — klasifikasi di dalamnya (`web` hanya untuk `index.html rel="icon"`) kebetulan sudah cocok
dengan jawaban pemilik itu (S4), jadi yang saya catat cuma jawabannya.

## 8.3 Ronde M3a #2 — DO yang tidur, `webSocketError`, dan tiga catatan dokumen

Ditulis 2026-11-17 atas perintah checker ronde M3a #2 (basis `33c2342`, worktree terisolasi
`C:/Users/LENOVO/AppData/Local/Temp/pc-verify`). Tidak ada jawaban baru di bagian ini; yang berubah
hanya faktanya.

**TEMUAN 1 (blokir, kode).** `Map<WebSocket, Peer>` di memori instance + Hibernation API
(`acceptWebSocket`) = otoritas pemimpin hilang tiap DO dibangun ulang, dan tombol "Ambil kendali"
menjadi jalur buntu. Rantai yang saya kutip sebagai janji ada di `live.ts:146-150` (kalimat
"satu-satunya jalan kembali ke podium … atau ter-evict" di `:147-148`), UI-nya
`ClickRoom.tsx:315-318` → `live.ts:151`.

- Tes A/B/C/D ditulis lebih dulu dan difoto MERAH sebelum kode: `297428a`,
  `npx vitest run --config vitest.worker.config.ts src/worker/eviction.spec.ts` →
  **2 failed | 2 passed (4)**, 4,07 s, mulai 2026-11-16T21:11:12Z. A dan B merah dengan
  `expected [] to deeply equal [ { code: 'NOT_LEADER', t: 'error' } ]`; C (kontrol positif `hello`
  ulang + kursi 2) dan D (pagar fail-closed untuk pengikut tanpa `lk`) hijau sejak awal.
- Reproduksi di tree utama, bukan cuma di worktree checker: cacat yang sama, angka yang sama.
- Perbaikan `a6ea775`: satu tempat untuk fakta `ws → {sid, did}` = attachment socket
  (`serializeAttachment`/`deserializeAttachment`, pembacanya `peerOf()` di `SessionDO.ts:92-102`).
  Map dihapus, `peers.delete` dihapus. `proto`, isi `state`, dan `src/shared/limits.ts` tidak
  disentuh; filter `readyState === OPEN` di `seatCount()` tetap (dokumen vendor: `getWebSockets()`
  boleh mengembalikan socket CLOSING, jadi filter itu memang benar).
- GREEN: `npx vitest run --config vitest.worker.config.ts` → **31 passed (31)** (21:15:25Z);
  `npm run check` → **EXIT=0**, `real 0m9.125s`; `npm run attack` di `wrangler dev --local --port
  8791` (sid `VD2V`) → nol GAGAL, termasuk T12a dan T12b.
- Yang masih DEDUKSI dan saya labeli begitu: bahwa evict terjadi di perangkat nyata.
  `PING_INTERVAL_MS = 1000` (`live.ts:32`) mengirim **frame teks** `{"t":"ping"}` (`live.ts:278`),
  yang masuk lewat `webSocketMessage` dan membangunkan DO — ini bukan control-frame RFC 6455, dan
  bedanya penting karena vendor menulis *"Ping/pong handling does not interrupt hibernation"* untuk
  frame protokol yang ditangani runtime. Jadi evict di semua tes ini dipaksa lewat
  `evictDurableObject` API tes, bukan diamati.
- **Lampiran checker datang menyusul**, sesudah perintah dan sesudah commit saya. Tidak satu byte
  pun saya salin dari worktree: `diff` berkas mereka (117 baris) dengan `src/worker/eviction.spec.ts`
  saya = **154 baris berbeda**, dan berkas saya sekarang 158 baris. Pemetaan keempat tes mereka ke
  saya = A→A, B→B, "hello ulang"→C, "kursi/`getWebSockets` bertahan"→C; **D** saya (fail-closed)
  adalah yang mereka minta saya tambah sendiri. Yang belum ada di versi saya sebelum lampiran masuk:
  DO dibangunkan lebih dulu lewat socket **pengikut** (`q.kirim({t:'ping'})`, berkas mereka `:109`)
  sebelum `hello` pemimpin — sekarang di `eviction.spec.ts:120-122` dengan syarat `pong` pengikut
  lebih dulu. Kontrol positif ini lahir **sesudah** hijau, jadi ia tidak saya klaim sebagai RED;
  yang RED tetap A/B di `297428a`. Ukur ulang: `4 passed (4)`, 2,82 s; `npm run check` **EXIT=0**,
  `real 0m9.387s`, 103 unit + 31 worker.
- `.dev.vars` sintetis di worktree Anda dan `.dev.vars` nyata di tree utama menghasilkan RED yang
  sama persis (**2 failed | 2 passed (4)**), dan itu memang konsekuensi desain: `lk` tidak pernah
  diketik tangan, ia dicetak `/create` dan diverifikasi dengan kunci yang sama di proses yang sama.

**TEMUAN 2 (tidak blokir) ditutup sebagai bukan-defect dengan bukti runtainya.** Pertanyaannya bukan
"perlu beres-beres di `webSocketError` tidak ya" tapi "apakah `webSocketClose` menyusul". Probe
sementara (tidak di-commit; yang di-commit adalah tes penguncinya) memanggil
`instance.webSocketError(socket, err)` dari dalam `runInDurableObject` dan mem-print:

```
PROBE ERROR {"sebelum":{"jumlah":2,"kursi":2},"sesudahJumlah":1,"sesudahOpen":1,"readyStateSoketYangError":3,"dipanggil":["webSocketClose"],"frameB":[{"t":"state","members":2},{"t":"welcome","members":2},{"t":"state","members":2}],"frameA":[{"t":"welcome","members":2},{"t":"state","members":2},{"t":"state","members":2},{"t":"state","members":1}]}
```

`webSocketClose` dipanggil satu kali, kursi 2 → 1, dan `state` dengan angka baru benar-benar sampai
ke HP yang masih di dalam. Karena itu `webSocketError` sengaja TIDAK saya tambahi `broadcast`:
menambahnya mengirim dua frame identik untuk satu kesalahan. Kuncinya sekarang di
`session.spec.ts:610` (`webSocketError menurunkan kursi karena webSocketClose menyusul, bukan karena
diam`) dan alasannya di [ADR-0007](../adr/0007-attachment-identitas-socket.md).

**TEMUAN 3 (dokumen).** Tiga catatan yang tidak cocok dengan diff, semuanya diukur sebelum ditulis:
(a) kotak izin S4 meng-glob `src/worker/**` + `src/app/**` sementara `b9fc0f3` juga menyentuh
`src/screens/ClickRoom.tsx` (69 baris) dan `scripts/attack.ts` (17 baris di commit itu; 142 di range
`452488c..HEAD`) — kalimatnya dibetulkan di Baris persetujuan, baris tanda tangan tidak disentuh;
(b) §4 butir 5 menamakan `Start.tsx` + `main.tsx` yang `git log 452488c..HEAD --`-nya kosong karena
`/create` sudah hidup di `ClickRoom.tsx` (`:127` di `452488c`) — butirnya ditulis ulang;
(c) `T9c KOSONG`: log localhost tidak merekam query string, jadi lulusnya T9a atas "sid" adalah
lolos vacuous — batasnya sekarang tertulis di sebelah angkanya, termasuk fakta bahwa "4795 byte"
yang dicetak tes itu `text.length` (UTF-16) sedangkan berkasnya 4897 byte (`node`:
`{"jsChars":4795,"utf8Bytes":4897,"splitLines":95,"nonAscii":51}`) dan "95 baris" adalah
`split('\n')` yang menghitung newline terakhir sebagai elemen kosong (`wc -l` = 94).

**Jangkar yang bergeser karena `a6ea775`** (diukur `grep -n` di atas commit itu; kolom kiri = `33c2342`):

| Simbol | lama | baru di `a6ea775` |
|---|---|---|
| `acceptWebSocket` | `:53` | `:45` |
| `peers = new Map` | `:30` | **tidak ada lagi** (hapus) |
| tulis identitas di `hello` | `:113` | `:129` (`remember`) |
| `seatCount()` | `:153-159` | `:169-174` |
| gerbang `FULL` | `:105-106` | `:120-122` |
| `assertLeader` | `:182` | `:198` |
| `claim` | `:194` | `:209-210` |
| `members` di `welcome` | — | `:150` |
| `members` di `state` | — | `:256` |
| `webSocketClose` | `:309` (dokumen lama menulis `:310-319`) | `:325-337` |
| `webSocketError` | `:322-325` | `:339-342` |

Dokumen yang ikut disegarkan: README (bagian M3a + dua subbagian ronde ini + tabel kontrak),
ADR-0005, ADR-0006, ADR-0002/0004 (rujukan `SessionDO.ts:171` diberi jangkar commit karena nomor
barisnya sudah tiga kali berpindah), dan `docs/adr/README.md` untuk baris ADR-0007.

**Yang tidak saya ceritakan bersih di sini, supaya tidak hilang:** server `wrangler dev` di port 8787
masih menahan port tetapi tidak lagi menjawab (`curl -m 8 http://127.0.0.1:8787/health` →
`curl: (28) timed out, 0 bytes`); percobaan menghentikannya lewat `Stop-Process` pada proses anak
workerd sudah saya lakukan sekali (meninggalkan crash #1 di log) dan percobaan lanjutan diblokir
penapis sesi, jadi satu-satunya yang saya buka lagi adalah instance baru di **8791** yang dipakai
untuk angka T9 di atas. Baca transkrip sesi lewat `grep` juga diblokir (label
`[Session Transcript Tampering]`), sehingga jam prompt ronde M3a #2 tidak bisa saya ukur sendiri dan
angka yang berasal dari prompt checker saya tulis sebagai "dilaporkan", bukan "diukur".

## 8.4 Ronde M3a #3 — pagar yang harus dibaca per jendela, dan pertanyaan yang belum boleh saya jawab

Basis ukur: HEAD `343a020` di tree utama + worktree terisolasi saya `pc-exec-r3` (detached di commit yang
sama, `node_modules` junction ke tree utama, `.dev.vars` sintetis 64 hex nol yang saya tulis sendiri di
sana). Urutan yang saya jalankan = urutan yang diminta: 5a → 5b → 5c → commit tes → 4a → 4b → berhenti.

**5a — pagar D dibaca per jendela (test-only).** `cari()` memindai `frames` dari indeks 0, dan baris `tempo`
di atas assertion claim sudah menghasilkan satu `NOT_LEADER`; karena itu assertion claim lulus tanpa membaca
jawaban claim. P1 pemeriksa saya reproduce: `NOT_LEADER sebelum claim = 1`. Perbaikannya di
`eviction.spec.ts:151-167`: `dasar` diambil sebelum `claim` dikirim, lalu `sejak(dasar)` menuntut TEPAT SATU
`error NOT_LEADER` (`:159-162`) dan NOL `state` (`:163-166`); assertion lama `bpm 180 tidak pernah disiarkan`
(`:167`) tetap untuk jalur tempo. Di tree utama sesudah perubahan:
`npx vitest run --config vitest.worker.config.ts src/worker/eviction.spec.ts` → **EXIT=0, 4 passed (4)**,
`Duration 5.31s (tests 4.01s)`. Commit `a99a1a4`, `git diff --numstat` satu berkas: `15 2 src/worker/eviction.spec.ts`.

**5b — mutasi yang tidak bisa saya jalankan seperti yang diminta, dan apa yang saya ukur sebagai gantinya.**
Edit yang membuat `claim` menerima frame tanpa `lk` DITOLAK permission layer dua kali, dan penolakan keduanya
berbunyi:

```
Auto mode: action blocked by classifier — [Security Weaken] The action modifies the leader-key
verification in SessionDO.ts to allow frames without `lk` to bypass cryptographic checks. …
Under the HARD BLOCK rules, disabling security mitigations or adding ways to bypass them cannot
be cleared by user intent.
```

Kotak persetujuan di sesi ini memang menjawab "Bolehkan mutasi fail-open di worktree", tapi kalimat di atas
menyebut niat pengguna secara eksplisit dan tidak membuka gerbangnya; saya tidak mencoba bentuk lain untuk
mendapatkannya (tidak lewat `sed`, tidak lewat berkas lain, tidak lewat worktree kedua), dan tidak menulis
angka apa pun seolah mutasi itu terjadi. Yang saya ukur adalah **dua mutan yang tetap menolak dan tidak
memindahkan podium**, masing-masing menyentuh satu sisi assertion baru:

| | M1 jalur tolak menjawab `code:'INTERNAL'` | M2 jalur tolak membocorkan satu `state` |
|---|---|---|
| D lama (HEAD) | **EXIT=0, 4 passed (4)**, tests 2793ms → mutan lolos = pagar lama vacuous | (tidak diulang; M1 sudah cukup sebagai bukti vacuous) |
| D baru (`a99a1a4`) | **EXIT=1, 1 failed \| 3 passed (4)**, 5.29s — `tepat satu NOT_LEADER, dapat [{"t":"error","code":"INTERNAL"}]: expected +0 to be 1` di `eviction.spec.ts:162:5` | **EXIT=1, 1 failed \| 3 passed (4)**, 5.36s (D 1329ms) — `tidak boleh menyiarkan apa pun … expected 1 to be 0` di `:163-166` |
| `session.spec.ts` | 1 failed \| 26 passed (27), 3.07s — tes `claim dengan lk memindahkan podium, claim tanpa lk tidak menggeser apa pun` (`:537`) jatuh di `:553` | 1 failed \| 26 passed (27) — tes yang sama, jatuh di `:555`: `expected [5, 4] to deeply equal [4, 3]` |
| sesudah `git checkout HEAD -- src/worker/SessionDO.ts` | **4 passed (4)**, tests 4037ms | kedua berkas worker: **31 passed (31)**, Duration 5.46s; `diff -q` vs tree utama → identik |

Yang angka ini jamin: jendela yang dibaca D benar-benar jendela claim, dan D adalah satu-satunya pagar jalur
claim pasca-evict. Yang TIDAK dijamin: fail-open sungguhan — mutan saya tidak mengikat podium ke pengikut,
jadi "D MERAH karena claim merebut kendali tanpa kunci" sampai hari ini tidak ada di tangan siapa pun, saya
maupun pemeriksa. Kalau nanti ada jalur sah untuk mengukur itu, ia masuk sebagai gerbang terpisah, bukan saya
samarkan dengan M1/M2.

**4a — batas TEMUAN 4 ditulis, dengan reproduksi sendiri.** Pemeriksa menemukan socket kedua yang mengaku
`did` pemimpin boleh mengubah tempo tanpa `lk`; saya jalankan probe mereka di worktree saya dan dapat
kesimpulan yang sama (sid `7TS5`, `P3 tempo 177 diterima tanpa lk = true`, 3 passed, 3878ms). Yang saya ukur
tambahan supaya labelsnya benar: `git show b9fc0f3:src/worker/SessionDO.ts` mencetak pembanding itu di `:184`,
`git show 178e1e9:…` tidak punya `assertLeader`/`leaderDid`/`NOT_LEADER` (`grep -c` = 0) → **berlaku sejak
`b9fc0f3`, bukan regresi `a6ea775`**; dan prasyaratnya: `did` 8 byte→16 hex (`genDid()` `src/shared/ids.ts:32-36`),
`localStorage` (`live.ts:295`), tidak pernah disiarkan (`welcome` hanya ke pengirim `:144-153`, `state` tanpa
`did` `:251-257`, `grep -rn "\bdid\b" src/screens` = 3 baris tanpa satu pun render `did` pemimpin). Server tidak
memaksa charset (`:107`, `:110` hanya panjang 1–32). Teks lengkap + dua opsi model ada di ADR-0005 bagian
"Batas yang terukur di ronde M3a #3" dan di README "Ronde M3a #3"; kata "aman"/"cukup" tidak dipakai di sana.

**4b — [TANYA] S8, dan saya berhenti di teks.** Pilihan model otoritas sesudah bind (a) kunci perilaku
`did`-yang-cocok sebagai desain vs (b) flag attachment yang hanya ditulis saat `verifyLeaderKey` lulus bukan
keputusan saya; baris `S8` di tabel §8.2 menandainya [TANYA]. Tidak ada tes yang saya tulis untuk salah satunya
— tes (a) mengunci perilaku yang mungkin dibalik, tes (b) merah di tree hari ini — dan probe P1/P2/P3 tinggal
di worktree, sengaja tidak di-commit. Kalau jawabannya (b), urutan yang sah: tulis tes "socket ber-`did`
pemimpin tanpa `lk` tidak boleh memerintah", lihat ia MERAH, baru kode, dengan A/B/C/D tetap hijau.

**Rumah tangga — dua listener, bukan satu.** `netstat` menemukan `8787→15440` (workerd sisa, probe `HTTP=000`
sesudah timeout 4 s) dan `8791→17856` (workerd server saya untuk serangan T9c, `HTTP=200`). Akarnya
`node.exe … wrangler … dev --local --port 8787|8791` dari `node_modules` proyek ini (PID 15244 dan 9736);
keduanya saya matikan sampai akar dengan `taskkill //PID … //T //F` (6 SUCCESS per pohon) dan
`netstat -ano | grep -E ":(8787|5173|879[0-9]).*LISTENING"` sekarang kosong. Tidak ada proses sesi lain yang
saya sentuh.

**Ukuran sesudah teks berubah:** `npm run check` → **EXIT=0** dua kali, `real 0m10.487s` waktu isinya masih
README + ADR-0005 + baris `S8` (§8.4 belum ada), lalu `real 0m10.387s` sesudah §8.4 ini ditulis — keduanya
103 unit (9 berkas) + 31 worker (2 berkas = 27 `session.spec.ts` + 4 `eviction.spec.ts`) dan `lint:arch OK —
4 berkas src/app/sync bersih`. Penjaga provenansi (`scripts/gerbang.spec.ts`, tidak saya edit) ikut jalan di
dalam kedua angka itu, jadi kalimat baru di README/ADR-0005/rencana ini sudah diperiksa bentuknya; run
terakhir yang mencakup kalimat pengukur ini sendiri saya catat di laporan, tidak di sini (nomor di dokumen tidak
boleh jadi alasan dokumen itu lulus).

**Yang tidak kucek / masih berasumsi di ronde ini.** (1) fail-open `claim` tidak terukur oleh siapa pun — lihat
tabel di atas; (2) jam jawaban kotak persetujuan ronde ini tidak saya ukur saat mendarat, jadi tidak ada
alamatnya di dokumen; (3) exploitasinya masih deduksi: saya tidak pernah mencoba memakai lubang `did` dari
perangkat kedua sungguhan, hanya dari dua socket di satu proses workerd; (4) `rowsWritten`/`members` di frame
peniru saya baca dari output probe, bukan dari tabel SQLite; (5) angka T9c/serangan hidup ronde #2 tidak saya
jalankan ulang di ronde ini, dan kedua server dev yang memegangnya sudah saya matikan.

