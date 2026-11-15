# Rencana M3 — ParanoidClick: otoritas pemimpin di server

**Dibuat**: 2026-11-15 (setelah 26 Okt 2026 16:45 WIB, sesuai QODER.md:5)
**Milestone**: M3 — "otoritas pemimpin di server" (`README.md:8`, `QODER.md:56`)
**Skill yang dipanggil untuk tahap ini** (`QODER.md:56`): `ecc:api-design`, `ecc:contract-first`,
`ecc:security-and-hardening`, `ecc:error-handling`
**Status kode hari ini**: BELUM ADA SATU BARIS PUN yang diubah. Berkas ini sendiri adalah
satu-satunya tulisan yang dibuat sampai ada persetujuan.

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

## 2. Fakta yang mengikat desain (sudah diverifikasi di tree ini, bukan diingat-ingat)

| Faktus | Bukti | Konsekuensi |
|---|---|---|
| `tok` = HMAC(kunci, `sid`) — kapabilitas **sesi**, bukan kapabilitas **pemimpin** | `index.ts:36-37`, `index.ts:74-75` | token yang sama dipegang pemimpin dan kesebelas HP; `tok` TIDAK BISA menyatakan otoritas |
| `/create` hanya dipanggil browser pemimpin; pengikut masuk lewat URL join | `index.ts:66-75`, `main.tsx` (join → `role="follower"`), `Start.tsx:34` | ada persis satu jalur yang bisa menerima kunci tambahan tanpa mengubah tautan join |
| `hello` membawa `did` (≤32 char, dari localStorage) | `SessionDO.ts:68-70`, `live.ts:83`, `live.ts:269` | `did` cukup sebagai **identitas**, dan ia selamat dari reload/tab bangun |
| Kapasitas dan `members` dibaca dari `SELECT COUNT(*) FROM member` | `SessionDO.ts:76-79`, `:95`, `:137` | begitu dasar hitungan diubah jadi socket hidup, gerbang `FULL` ikut berubah — bukan gratis |
| Siaran lewat `this.ctx.getWebSockets()` | `SessionDO.ts:148` | jumlah socket hidup sudah bisa dibaca tanpa tabel baru |
| Klien lama menampilkan frame `error` apa pun sebagai `server menolak: <kode>` | `live.ts:232-233` | kode error baru = degradasi terlihat di HP yang sudah ter-install, bukan crash |
| `proto` = 2 | `index.ts:63` (lihat README M1a) | kalau `hello` perlu key baru, itu pertanyaan bump versi — keputusan terpisah |

## 3. Keputusan yang saya ajukan (satu jalur, bukan menu)

**Otoritas = kunci pemimpin yang dicetak terpisah saat `/create`.**

- `/create` mencetak `lk = HMAC(kunci, sid + ":leader")` dan hanya mengirimnya di JSON `/create`.
  Tautan join / QR (`?sid=&tok=`) TIDAK memuat `lk`. Yang membagi tautan tetap cuma bisa jadi
  anggota.
- `hello` membawa `lk`. DO memverifikasinya (`crypto.subtle.verify`, sama seperti `tok`) dan,
  kalau sah, mengikat `leaderDid = did` pada baris tunggal tabel `leader` (POLA sama dengan
  tabel `tempo` di `SessionDO.ts:21-23`: `CHECK(id = 1)` — keadaan tidak boleh bercabang).
- `tempo` / `start` / `stop` dari `did` selain `leaderDid` → `{t:'error', code:'NOT_LEADER'}`,
  keadaan sesi tidak tersentuh. Pemimpin yang reconnect dengan `did` yang sama (jalur
  **"Lanjut ke sesi"**, `Start.tsx:37-45` + `rememberTarget`) mendapat kendalinya kembali tanpa
  `/create` baru — ini jalur pemulihan, bukan jalur baru.
- Alternatif yang saya **tolak**: (a) klaim-pertama-datang (siapa pun yang membuka tautan lebih
  cepat jadi diktator, dan setelah DO eviksi orang asing bisa jadi pemimpin); (b) PIN join
  (pantas hidup di M4 bersama QR, bukan sekarang); (c) otoritas tanpa kunci (server tidak bisa
  membedakan pemimpin dari pengikut — itu justru intinya).

## 4. Dampak + telaah cakupan — setiap tempat yang harus disentuh

**Kode produksi**
1. `src/worker/index.ts` — `/create` mengembalikan `{sid, token, leaderKey, wsPath}`. Rute `/ws`
   tidak berubah (verifikasi `tok` tetap gerbang masuk ruangan).
2. `src/worker/SessionDO.ts` — tabel `leader` (DDL di bawah), `hello` mengikat pemimpin,
   penjaga `assertLeader(did)` di tiga frame perintah, `state` tidak berubah isinya.
3. `src/shared/limits.ts` — `code:'NOT_LEADER'` masuk daftar kode yang dikenal (supaya tes
   serangan tidak mengira ini frame tak dikenal).
4. `src/app/session/live.ts` — `LiveTarget` dapat `lk?` opsional; `hello` mengirimnya kalau ada;
   `rememberTarget` menyimpannya (kalau tidak, pemimpin yang layarnya mati kehilangan podium).
5. `src/screens/Start.tsx` + `src/main.tsx` — `lk` mengalir dari JSON `/create` ke `ClickRoom`
   lewat target, BUKAN lewat URL.
6. `src/screens/ClickRoom.tsx` — `leader` bukan lagi sekadar peran UI: jadi
   *"punya lk DAN server mengakui did-ku"*. Tombol pengikut tetap disabled; pemimpin yang
   receive `NOT_LEADER` melihat statusnya, bukan bisu.

**Test yang berubah atau lahir** (semuanya ditulis GAGAL dulu, sesuai `QODER.md:42`)
- `src/worker/session.spec.ts` (+4): pengikut kirim `tempo` → `NOT_LEADER` dan `bpm`/`anchor`
  **tidak berubah**; pemimpin kirim → lahir; reconnect pemimpin dengan `did` sama → masih pemimpin;
  dua HP berbeda `did` sama-sama bawa `lk` sah → yang pertama mengikat, yang kedua `NOT_LEADER`.
- `src/app/session/live.spec.ts` (+2): `hello` membawa `lk` kalau pemimpin dan tidak membawa
  kalau pengikut; `onStatus` menampilkan penolakan `NOT_LEADER` (jalur pemulihan tidak boleh
  jadi cabang mati, `QODER.md:40`).
- `src/shared/limits.spec.ts`: kode baru lolos parser, dan frame tanpa `lk` tetap `hello` sah.
- `scripts/attack.ts`: kasus baru — 12 socket anggota mengirim `tempo` bergantian; keadaan sesi
  tidak boleh berubah satu byte pun, dan `state` tidak boleh disiarkan.
- **Yang bisa pecah dan harus diakui di muka**: tiga tes `session.spec.ts` yang sekarang menuntut
  `members` dari `SELECT COUNT(*)`, dan tes `orang ke-13 ditolak FULL` — kalau kapasitas pindah
  dasar hitungan, tes itu berubah MAKNA, bukan sekadar angka. See §6 [TANYA] 2.

**Dokumentasi** — README bagian M3 (angka mentah, bukan prosa), ADR-0005 untuk kunci pemimpin
(ini keputusan arsitektur: ada alternatif yang ditolak dan ada konsekuensi), `docs/adr/README.md`.

**Yang TIDAK disentuh**: `bukti/`, `.dev.vars`, kunci produksi, tidak ada deploy, tidak ada push,
tidak ada dependensi baru, `proto` tetap 2 sampai §6 [TANYA] 1 dijawab.

## 5. Skema lokal dulu (perintah DDL, TIDAK dijalankan ke produksi)

```sql
CREATE TABLE IF NOT EXISTS leader (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  did TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);
```

Dibuat dan diverifikasi di `wrangler dev --local` (SQLite DO lokal) + tes worker. Migrasi ke
produksi = keputusan terpisah, dan `CREATE TABLE IF NOT EXISTS` dipilih supaya sesi yang sudah
hidup tidak perlu dihancurkan.

## 6. [TANYA] — empat hal yang tidak boleh saya putuskan sendiri

1. **Perlu tidak `proto` naik 3?** Kalau `lk` ikut di `hello` dan klien lama tidak mengirimnya,
   klien lama tetap masuk sebagai anggota (benar), tapi tidak ada satu pun pemimpin baru dari
   klien lama. Saya usulkan `proto` tetap 2 + `lk` opsional di frame; setujui atau koreksi.
2. **Dasar kapasitas 12 HP**: ikut socket hidup (HP yang pulang langsung membuka kursi, tapi
   banjir reload bisa rebut-menolak) atau tetap riwayat (tes `FULL` yang sekarang tetap benar)?
3. **Rebut pemimpin**: boleh ada tombol "ambil kendali" yang sah (butuh `lk`, jadi cuma pemimpin
   yang punya kunci yang bisa merebut), atau tidak ada rebut sama sekali sampai `sid` baru?
4. **Setlist**: tetap di M3 (tambah satu tabel + satu layar) atau dipecah jadi M3b setelah
   otoritas hijau? Saya usulkan dipecah — M3a saja dulu.

## 7. Gerbang sebelum commit apa pun boleh disebut selesai

- `npm run check` hijau (typecheck, `lint:arch`, unit, worker) dengan test yang ditulis lebih dulu.
- RED difoto dan dikutip di pesan commit (angka, bukan "sudah gagal").
- `npm run attack` hijau di worker lokal, termasuk kasus `NOT_LEADER` baru.
- Ukur di stack hidup: pengikut yang memaksa `tempo` lewat socket → `NOT_LEADER`, `bpm` dan
  `anchor` kedua layar tetap identik, `0 hilang` tidak berubah.
- Tidak di-push, tidak di-deploy.

---

## Baris persetujuan

Saya sudah membaca rencana ini dan menyetujui:

- [ ] **§3 kunci pemimpin (`lk` dari `/create`, tidak lewat tautan join)** sebagai desain M3a
- [ ] **§6.1** `proto` tetap 2, `lk` opsional di `hello`
- [ ] **§6.2** dasar kapasitas: `__________`
- [ ] **§6.3** rebut pemimpin: `__________`
- [ ] **§6.4** setlist dipecah ke M3b (M3a saja dulu)
- [ ] Boleh menyentuh `src/worker/**` dan `src/app/**` **hanya** untuk irisan yang tercantum di §4

Persetujuan pemilik: `________________________`  Tanggal: `____________`

Sampai kotak-kotak ini diisi, satu-satunya yang saya kerjakan adalah yang tidak menyentuh kode:
dokumen, ukur ulang, dan berkas rencana ini.
