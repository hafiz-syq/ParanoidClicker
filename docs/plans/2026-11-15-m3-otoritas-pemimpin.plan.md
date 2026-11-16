# Rencana M3 — ParanoidClick: otoritas pemimpin di server

**Dibuat**: 2026-11-15 (setelah 26 Okt 2026 16:45 WIB, sesuai QODER.md:5)
**Direvisi**: 2026-11-15 — empat [TANYA] di §6 sudah dijawab pemilik; jawabannya dilipat ke §2–§4
**Direvisi**: 2026-11-16 — lihat **§8 KOREKSI**. Tiga atribusi pemilik di revisi 15/16 Nov memang
punya jawaban nyata, tapi tidak satu pun beralamat; sekarang tiap klaim di file ini menunjuk kunci
`S1`–`S6` di tabel alamat turn §8.2.
**Milestone**: M3 — "otoritas pemimpin di server" (`README.md:8`, `QODER.md:56`)
**Skill yang dipanggil untuk tahap ini** (`QODER.md:56`): `ecc:api-design`, `ecc:contract-first`,
`ecc:security-and-hardening`, `ecc:error-handling`
**Status kode**: kotak terakhir Baris persetujuan DIBUKA pemilik 2026-11-16T16:50Z (S4) → irisan §4
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

   **Tafsir §6.2 — PERTANYAAN BERNAMA, bukan penarikan total.** Yang dicentang pemilik dan yang jadi
   dasar kode hari ini: **jumlah socket hidup MENTAH** dari `getWebSockets()` — itu bunyi harfiah
   jawaban 15 Nov (S1), dan itu yang dikerjakan (S6). Yang masih `[TANYA]`: apakah socket dihitung
   per `did` unik di antara socket hidup. Sesi saya mencatat sebuah label opsi *"did unik di antara
   socket hidup"* pernah dipilih lewat AskUserQuestion (S2 2026-11-15T18:46:12Z), tapi prompt checker
   2026-11-16 (S6) menyatakan pemilik **tidak** menjawab tafsir itu. Dua catatan itu bertentangan dan
   keduanya saya biarkan tertulis; yang saya putuskan cuma satu: **kode mengikuti S6 (socket mentah),
   tidak ada dedupe `did`, dan tidak ada tes yang mengasumsikannya.**
   Konsekuensi (S6) yang saya ukur sendiri dan harus dibaca pemilik sebelum menjawab — dengan socket
   mentah, satu HP yang network-nya flap atau reload sebelum socket lama terdeteksi tutup memakan
   **2 kursi**, jadi ruangan 12 bisa menjawab `FULL` dengan 11 HP nyata di tengah latihan.
   Dua tes yang berubah kalau jawabannya "ya": gerbang `FULL` (`:76-77`) dan `members` di `welcome`
   (`:95`). Butir 2b–2c sendiri tidak ditahan lagi — kerjakan dengan socket mentah.
3. `src/shared/limits.ts` — **TIDAK disentuh.** Butir ini saya tulis salah di versi pertama
   rencana ini: `FrameCode` (`limits.ts:7`) adalah daftar penolakan *bentuk frame*
   (`TOO_BIG`/`TOO_DEEP`/`BAD_KEY`/`BAD_TYPE`), bukan daftar kode error di wire. Kode wire
   (`PROTO` di `:62,71,195`, `FULL` di `:79`, `BAD_BPM` di `:167`) memang literal di
   `SessionDO.ts` dan tidak pernah diregistrasi di mana pun; `live.ts:233` mencetak apa pun yang
   datang. Jadi `NOT_LEADER` tidak butuh perubahan di `src/shared/`.
4. `src/app/session/live.ts` — `LiveTarget` dapat `lk?` opsional; `hello` mengirimnya kalau ada;
   `rememberTarget` menyimpannya (kalau tidak, pemimpin yang layarnya mati kehilangan podium).
5. `src/screens/Start.tsx` + `src/main.tsx` — `lk` mengalir dari JSON `/create` ke `ClickRoom`
   lewat target, BUKAN lewat URL.
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
| 2 | Dasar kapasitas 12 HP: socket hidup atau riwayat? — **dan pertanyaan bernama yang tersisa: socket mentah atau per `did` unik?** | **"Socket hidup (getWebSockets)"** (S1) yang nyata dicentang. Tafsirnya jadi PERTANYAAN yang saya tanya ulang, bukan jawaban: catatan S2 bilang sebuah label "did unik di antara socket hidup" pernah dipilih, arahan checker 16 Nov (S6) bilang pemilik tidak menjawabnya → **[TANYA]**, dan kode hari ikut S6 = socket MENTAH | §4 butir 2b–2c; tabel `member` tetap untuk `rowsWritten`; dua tes yang berubah kalau jawabannya "ya" = gerbang `FULL` + `members` di `welcome` |
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
      cuma frasa tambahan "dan ditafsirkan per `did` unik ketika ditanya ulang 2026-11-16" — itu
      pertanyaan yang belum terjawab, lihat §4 butir 2b dan [TANYA]
- [x] **§6.3** rebut pemimpin: **dengan `lk`, eksplisit** (tombol "Ambil kendali")
- [x] **§6.4** setlist dipecah ke **M3b** (M3a saja dulu)
- [x] **Boleh menyentuh `src/worker/**` dan `src/app/**`** untuk irisan yang tercantum di §4 —
  DIBUKA pemilik 2026-11-16 23:50 WIB, kata kerjanya "lanjutkan ke tahap selanjutnya", sumber
  `via 2d6f4ca7@2026-11-16T16:50Z` (S4). Kanal jawabannya sesi checker, dirolay ke saya lewat
  prompt — bukan turn di sesi ini, dan itu sebabnya penanda sumbernya menunjuk sesi lain.
  Ini satu-satunya kotak yang pemilik buka hari itu (S6).

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

Yang salah bukan *isi* jawabannya. Yang salah tiga hal lain:

1. **Tidak ada alamat.** Tidak ada `sessionId`, tidak ada timestamp, tidak ada kanal. Sesi checker
   mencari turn pemilik dengan `read_chat_session` pada sesi ini, tidak menemukannya, lalu menyimpulkan
   attribusinya fiktif — dan kesimpulannya masuk akal kalau hanya daftar turn itu yang dilihat.
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
(`S1`, `S2`). Kotak §6.2 tidak pernah saya ubah dari `[ ]` ke `[x]` — ukur sendiri:

```
$ for r in eaf5e63 1a30bba 452488c; do printf '%s ' $r; git show $r:docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md | grep -c "^- \[x\]"; done
eaf5e63 5
1a30bba 5
452488c 5
$ grep -c "^- \[x\]" docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md   # worktree sesudah koreksi ini
6
$ grep -n "^- \[ \]" docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md
245:- [ ] **Boleh menyentuh `src/worker/**` dan `src/app/**`** ...
```

Lima `[x]` + satu `[ ]` (kotak kode) di ketiga commit: tidak ada kotak yang berpindah status di
`1a30bba` — klaim checker "satu kotak `[ ]` → `[x]` tanpa ada yang mencentang" salah, dan baris 245
di atas adalah satu-satunya `[ ]` yang tersisa di worktree karena dia hidup di dalam blok kutipan §8.1,
bukan sebagai kotak aktif. Angka `6` di worktree bukan hasil koreksi atribusi: kotak kode baru dicentang
SESUDAH §8 ini ditulis, yaitu ketika jawaban pemilik S4 datang (2026-11-16T16:50Z, saya baca 17:32Z).

### 8.2 Tabel alamat turn (penanda `S1`–`S6`)

Cara membaca: buka sesi itu di Qoder, gulir ke menit timestamp-nya. **Alamat ini tidak bisa diverifikasi
oleh script** — kebijakan harness memblokir baca `~/.qoder/projects/*.jsonl` sejak 2026-11-16T16:38Z,
di tengah tugas ini, jadi `scripts/gerbang.spec.ts` hanya bisa memeriksa BEN-TUK alamat, bukan isinya.
`S1`–`S3` saya ukur sendiri dari log sebelum blokir itu; `S4`–`S6` dilaporkan sesi checker, dan jam
pada `S6` adalah jam UKUR SAYA saat membaca promptnya (`node -e "console.log(new Date().toISOString(),
new Date().getTimezoneOffset())"` → `2026-11-16T17:32:47.248Z -420`), bukan timestamp turn di sesinya.

| Kunci | Isi | Alamat | Kanal |
|---|---|---|---|
| S1 | empat jawaban §6: "Setuju, tapi jangan kode dulu" · "Socket hidup (getWebSockets)" · "Rebut dengan lk, eksplisit" · "M3b terpisah" | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T09:16:14.324Z | AskUserQuestion (pemilik memilih label yang saya tulis) |
| S2 | tiga jawaban: "Tahan dulu, tetap docs-only" · "did unik di antara socket hidup" · "Jangan pasang, tunda" | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:46:12.942Z | AskUserQuestion; pertanyaan-nya dikirim 18:44:44.543Z setelah panggilan pertama saya gagal parse (`Error: JSON_PARSE` 18:44:35.891Z) |
| S3 | perintah pemisahan logo: **"logo WEB pakai mark baru ini; logo APLIKASI tetap pakai yang lama."** | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:51:40Z | turn `CHECKER → EXECUTOR` di sesi ini; jamnya **dilaporkan** sesi checker (2d6f4ca7), saya tidak mengukur ulang; kutipannya kata pemilik yang dipetik checker, bukan kata saya |
| S4 | jawaban pemilik dua pertanyaan di sesi checker: **kotak kode M3a DIBUKA** ("lanjutkan ke tahap selanjutnya") + **`apple-touch-icon` = permukaan APLIKASI**, tetap `paranoid-180.png` | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:50:13.874Z | pemilik menjawab di sesi checker 23:50 WIB; isinya sampai ke saya **dirolay prompt checker**, bukan sebagai turn di sesi ini. Rewrite 16 Nov 17:07Z saya menulis baris ini sebagai "[TANYA] — belum sampai"; prompt berikutnya membawanya, jadi statusnya berubah jadi DIJAWAB dengan kanal relay |
| S5 | aturan berdiri: `JANGAN deploy`, `JANGAN push`, "tulis apa pun ke produksi butuh izin eksplisit pemilik", larangan skill `vercel-deploy`, larangan commit `tail*.log` | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:38:43Z | turn `CHECKER → EXECUTOR` yang memetik aturan pemilik; jamnya dilaporkan sesi checker, saya tidak mengukur ulang |
| S6 | dua prompt checker 16/17 Nov: (a) temuan provenance atas `1a30bba` + tuntutan assertion penjaga, (b) arahan B0–B4 yang menyatakan **pemilik TIDAK menjawab tafsir `did` unik** dan **`scripts/gerbang-ikon.mjs` jangan disentuh** | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T17:32:47Z [TANYA] | keduanya masuk ke sesi saya sebagai pesan; timestamp-nya jam ukur saya saat membaca (lihat paragraf di atas tabel), bukan turn di sesi checker — karena itu baris ini saya beri `[TANYA]`: bentuk alamatnya ada, jam turn-nya tidak bisa saya buktikan |

Konsekuensi `S2` yang bukan jawaban: "satu orang dua tab = satu kursi" adalah entailment saya dari
label `did` unik + `did` per-browser (`live.ts:269`), jadi dia ditulis sebagai *konsekuensi-if-ya* di
§4 butir 2b, bukan sebagai "keputusan resmi".

Konsekuensi `S2` yang **tidak jadi saya kerjakan**: prompt checker 2026-11-16/17 (S6) menyatakan pemilik
tidak menjawab tafsir `did` unik dan arahnya memakai socket hidup MENTAH. Keputusan operasional hari ini
mengikuti S6, tapi catatan S2 tidak saya hapus — konfliknya tetap tertulis, dan pertanyaan pemilik soal
tafsir §6.2 ini berstatus [TANYA] (S6 menyatakan belum dijawab), jadi bukan pilihan saya yang menjawabnya.
Dua tes yang berubah kalau
jawabannya "ya": gerbang `FULL` (`SessionDO.ts:76-77`) dan `members` di `welcome` (`:95`).

Satu jawaban S4 lagi yang menyentuh dokumen, bukan kode: **`apple-touch-icon` digolongkan permukaan
APLIKASI**, jadi `index.html` tetap menunjuk `paranoid-180.png` dan `scripts/gerbang-ikon.mjs` **tidak
diubah** — klasifikasi di dalamnya (`web` hanya untuk `index.html rel="icon"`) kebetulan sudah cocok
dengan jawaban pemilik itu (S4), jadi yang saya catat cuma jawabannya.

