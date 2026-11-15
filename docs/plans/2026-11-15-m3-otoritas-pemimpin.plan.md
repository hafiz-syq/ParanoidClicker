# Rencana M3 — ParanoidClick: otoritas pemimpin di server

**Dibuat**: 2026-11-15 (setelah 26 Okt 2026 16:45 WIB, sesuai QODER.md:5)
**Direvisi**: 2026-11-15 — empat [TANYA] di §6 sudah dijawab pemilik; jawabannya dilipat ke §2–§4
**Milestone**: M3 — "otoritas pemimpin di server" (`README.md:8`, `QODER.md:56`)
**Skill yang dipanggil untuk tahap ini** (`QODER.md:56`): `ecc:api-design`, `ecc:contract-first`,
`ecc:security-and-hardening`, `ecc:error-handling`
**Status kode hari ini**: BELUM ADA SATU BARIS PUN yang diubah, dan tidak akan ada sampai kotak
paling bawah di Baris persetujuan dicentang — pemilik menjawab *"Setuju, tapi jangan kode dulu"*.

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

   **Tafsir §6.2 — DIKONFIRMASI pemilik, 2026-11-16**: yang dihitung adalah **`did` berbeda di
   antara socket hidup**, bukan jumlah socket mentah. Tanpa itu, satu HP yang network-nya flap
   membuka dua socket dan memakan dua kursi — persis skenario "banjir reload" yang saya
   khawatirkan sendiri waktu bertanya. Konsekuensi yang sekarang resmi: satu orang dengan dua
   tab terhitung SATU kursi selama `did`-nya sama (dan `did` memang per-browser, `live.ts:269`).
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

| # | Pertanyaan | Jawaban pemilik | Jadi di rencana |
|---|---|---|---|
| 1 | Perlu `proto` naik 3? | **"Setuju, tapi jangan kode dulu"** | `proto` tetap 2, `lk` key opsional di `hello`; dan TIDAK ada satu baris kode pun ditulis sebelum kotak terakhir Baris persetujuan dicentang |
| 2 | Dasar kapasitas 12 HP: socket hidup atau riwayat? | **"Socket hidup (getWebSockets)"**, dan ditafsirkan **per `did` unik** ketika ditanya ulang 2026-11-16 | §4 butir 2b–2c; tabel `member` tetap untuk `rowsWritten` |
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

Pemilik sudah membaca rencana ini; jawabannya dicatat apa adanya (2026-11-15):

- [x] **§3 kunci pemimpin (`lk` dari `/create`, tidak lewat tautan join)** sebagai desain M3a — *"Setuju"*
- [x] **§6.1** `proto` tetap 2, `lk` opsional di `hello` — *"Setuju"*
- [x] **§6.2** dasar kapasitas: **socket hidup (`getWebSockets`)**, dihitung per **`did` unik** —
      tafsir dikonfirmasi pemilik 2026-11-16
- [x] **§6.3** rebut pemimpin: **dengan `lk`, eksplisit** (tombol "Ambil kendali")
- [x] **§6.4** setlist dipecah ke **M3b** (M3a saja dulu)
- [ ] **Boleh menyentuh `src/worker/**` dan `src/app/**`** untuk irisan yang tercantum di §4 —
  **DITANYA ULANG 2026-11-16, jawaban pemilik tetap: "Tahan dulu, tetap docs-only"**

Persetujuan pemilik (kotak terakhir, yang membuka kode): `________________________`  Tanggal: `____________`

Sampai kotak terakhir diisi, yang saya kerjakan hanya yang tidak menyentuh kode: dokumen, ukur
ulang, dan berkas rencana ini.
