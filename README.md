# ParanoidClick

Metronom sinkron untuk band Paranoid: beberapa HP mengikut satu tempo, HP yang membagi
QR jadi leader, lengkap dengan setlist dan hitungan suara.

Status: **spike M0** — mengukur RTT/jitter jaringan asli sebelum ada satupun fitur janji.

## Menjalankan

```
npm ci
cp .dev.vars.example .dev.vars
node -e "console.log('SESSION_SIGNING_KEY=' + require('crypto').randomBytes(32).toString('hex'))" > .dev.vars
npm run dev                         # worker di :8787 + vite di :5173
```

`.dev.vars` sudah di-gitignore dan isinya **token uji lokal saja** — jangan pernah dipakai
di produksi. Produksi memasang nilainya sendiri lewat `npm run secret` (`wrangler secret put
SESSION_SIGNING_KEY`), yang meminta satu baris hex 64 dari perintah `node -e` di atas. Cara
memastikan kunci menempel: `GET /health` menjawab `keyPresent: true`.

Buka http://localhost:5173 (atau :8787 untuk build yang sama seperti produksi).

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | worker lokal + app, dua-duanya |
| `npm run build` | bundel app ke `dist/` |
| `npm run preview` | build + sajikan lewat wrangler (paling mirip produksi) |
| `npm test` | logika murni (sinkron, batas frame, id) |
| `npm run test:worker` | Worker + Durable Object di runtime workerd asli |
| `npm run typecheck` | TS app dan TS worker |
| `npm run check` | ketiganya berurutan — gerbang sebelum commit |
| `npm run smoke` | jalur WebSocket asli, butuh `npm run dev:worker` |
| `npm run attack` | tes serangan T5/T6/T7/T9, butuh `npm run dev:worker` |

## Spike M0: apa yang diukur

Layar **Ukur 60 ping** mengirim 60 frame `ping` 1 Hz lewat WebSocket dan mencatat empat cap
waktu per perjalanan (t1 kirim, t2/t3 di server, t4 terima). Dari situ:

- **RTT** p50/p95 — berapa lama bolak-balik lewat Cloudflare,
- **θ** (offset jam) — selisih jam HP terhadap jam Durable Object,
- **jitter p95** — selisih estimasi θ antar window 8 sampel. Inilah angka penentu.

Ambang keputusan (dari HP di tempat latihan, bukan localhost):

| jitter p95 | kesimpulan |
| --- | --- |
| ≤ 15 ms | lanjut: servo 4 tingkat cukup |
| 15–40 ms | lanjut, tapi tombol re-anchor wajib ada di UI |
| > 40 ms | berhenti: butuh jam LAN/akustik sebagai sumber waktu |

`scripts/smoke-ws.ts` membuktikan pipa socket jalan di localhost; angkanya **bukan** bukti
jaringan. Catatan lapangan harus disalin dari kotak "Hasil" di layar spike dan disimpan.

## Gerbang keamanan M0

`npm run attack` (§15 T5/T6/T7/T9) dijalankan terhadap worker lokal dan harus hijau sebelum
apa pun di-deploy, lalu diulang terhadap deployment asli dengan `wrangler tail` menyala — lokal
membuktikan kodenya, produksi membuktikan platformnya tidak mengingkari kode itu. Kedua kolom
di bawah adalah hasil sebenarnya, bukan harapan.

| Tes | Yang dijaga | Hasil lokal | Hasil produksi |
| --- | --- | --- | --- |
| T5a | 30 `POST /create` dari satu IP | 3 lulus, 27 → `429` | 7 lulus, 23 → `429` — limiter free plan **bekerja** tetapi per-colocation dan approximate |
| T5b | 30 `/ws` dengan sid karangan sendiri | 30 → `403` JSON, DO tidak pernah tersentuh | 30 → `403` JSON dari Worker, bukan HTML dari edge |
| T6a–c | frame 1 MB string, 500 kurung, frame 12 MB | `TOO_BIG`, `TOO_DEEP`, `TOO_BIG` | `TOO_BIG`, `TOO_DEEP`, `TOO_BIG` |
| T6d | DO masih menjawab ping setelah semua bom | `pong` | `pong` |
| T7a/b | `__proto__` di frame | `BAD_KEY`, tanpa noda di `Object.prototype` | `BAD_KEY`, tanpa noda |
| T9a/b/c | payload dan token di log, plus kendali positif untuk T9b | dari 87 baris log dev: `0` memuat `sid=` atau `tok=`, jadi T9c melapor **KOSONG** (belum terbukti), bukan lulus | T9c **BUKTI**: log produksi memuat `?sid=NCFB&tok=REDACTED` |

Kolom produksi di atas baru berarti kalau permintaannya benar-benar sampai ke Worker. Run
produksi pertama justru mencetak `4 tes gagal`, dan ternyata semuanya cacat di alatnya, bukan
di worker: tiap bug di bawah ini hijau di lokal dan buta di produksi.

Bug 1 — Probe handshake WS memakai `node:http` dengan port default 80, jadi terhadap
`https://…workers.dev` ia mengirim HTTP polos, mendapat redirect 301 dari Cloudflare, lalu
**membaca status redirect itu sebagai kalau-nya jawaban Worker**. Sekarang modul dan port
dipilih dari skema `PC_BASE_URL`, dibuktikan dengan `wrangler dev --local-protocol https`:
T5b tetap `403` di atas TLS.

Bug 2 — `CF-Connecting-IP` karangan sendiri. Di lokal workerd menerima header itu apa adanya,
jadi T5a bisa memaksa 30 permintaan terlihat berasal dari satu IP. Di produksi **edge Cloudflare
menolak permintaan yang membawa header itu sebelum Worker sempat jalan**: jawabannya `403`
bertipe `text/html`. Run pertama mati di langkah bootstrap karena `JSON.parse` menerima HTML.
Sekarang header itu hanya dikirim kalau `PC_BASE_URL` menunjuk localhost, dan `/create`
bootstrap dijadikan kendali positif: kalau responsnya bukan JSON, ia mencetak status,
content-type, 80 byte pertama, dan petunjuk penyebabnya — bukan `SyntaxError` mentah.

Bug 3 — Handshake tanpa `Sec-WebSocket-Key` dan `Sec-WebSocket-Version`. Edge juga menolak ini,
dengan `400` HTML, dan Worker tidak pernah tersentuh — artinya T5b bisa saja melaporkan `403`
seolah-olah gerbang token bekerja padahal yang menjawab halaman edge. Sekarang probe mengirim
kunci handshake contoh RFC 6455, dan pemeriksaan T5b sekarang menuntut `content-type` berawalan
`application/json` di samping `403`; status 403/400 dari halaman edge tidak dihitung lulus.

Bug 4 — Jendela dengar bom yang buta waktu. `bomb()` dulu hanya mengumpulkan frame selama
700 ms. Upload 1 MB dan 12 MB ke Worker sungguhan lewat internet butuh lebih lama dari itu, jadi
T6a/T6c produksi melaporkan `close=1000 tanpa frame` — seolah-olah gerbangnya tidak menjawab.
Deadline sekarang 15 detik dan selesai lebih awal begitu frame pertama **selain** `welcome`
tiba; menunggu `welcome` saja akan melapor "lulus" untuk bom yang belum dijawab.

T5b adalah tambalan yang ditemukan oleh tes ini, bukan oleh desain awal: rate limit `/create`
saja tidak mengikat, karena `/ws?sid=XXXX` yang ditebak sendiri sudah cukup untuk melahirkan
satu DO SQLite, dan ruang sid hanya 1.048.576. Sekarang `/create` mengembalikan `token`
(HMAC-SHA256 atas sid dengan `SESSION_SIGNING_KEY`) dan `/ws` menolak tanpa token yang sah —
gerbangnya pindah ke sebelum `env.SESSION` dipanggil.

Batas yang jujur: token itu ikut di query string WS, karena browser tidak bisa mengirim header
saat handshake. Ia kapabilitas sekali-pakai per sesi dan tidak menambah rahasia baru (sid-nya
sendiri sudah ada di URL yang sama), tetapi **`resumeToken` dan `leaderToken` tetap tidak boleh
masuk URL** (§15 T9).

Soal log, pertanyaan yang tadi belum terbukti dua arah sekarang punya jawaban — dan jawabannya
lebih baik dari yang dijanjikan dokumen. `wrangler tail --format json` di produksi **mencetak
URL lengkap**, termasuk query string: `event.request.url` berisi
`https://…workers.dev/ws?sid=NCFB&tok=REDACTED`. Cloudflare sendiri yang mengganti nilai `tok`
dengan teks `REDACTED` sebelum entri sampai ke kita. Pengukurannya pada jendela log run ini
(200.403 byte, 42 field `url`): `tok=` muncul 21 kali, `tok=REDACTED` 21 kali, dan
`tok=[0-9a-f]` (nilai hex asli) **0** kali. `sid=NCFB` muncul 10 kali, jadi kendali positif T9c
hidup: log ini memang merekam URL, dan token tetap tidak ikut. Rantai 64 karakter hex yang
tersisa di log sudah diatribusi per field, bukan token — 11 di antaranya `durableObjectId`,
sisanya hash handshake TLS (96 hex).

Dua catatan yang menahan diri supaya tidak overclaim. Pertama, `wrangler tail` itu stream
best-effort, bukan audit log: 31 permintaan `/create` dikirim, hanya 21 yang muncul di log
(`200` 8x + `429` 13x), dan 30 sid palsu dikirim tapi `403` tercatat 11x. Buktinya jadi
"semua kemunculan token di-log disensor", bukan "tidak ada token di log" — dan untuk
`resumeToken`/`leaderToken` yang belum pernah dikirim, nol kemunculan di stream yang bocor itu
tidak membuktikan apa pun. Kedua, memindahkan token ke header juga tidak otomatis menyelamatkan
log: entri tail ikut mencetak request header, `cf-connecting-ip` tercatat 42 kali di jendela yang
sama.

Serangan ini bukan tanpa jejak di akun sendiri. Sekali jalan di produksi, ia meninggalkan sesi
DO sungguhan (run ini `NCFB`, sebelumnya `7ND3` dan `B298`) dan membuat IP aslimu menyentuh
`CREATE_LIMITER` selama 60 detik — jadi `npm run attack` terhadap URL produksi bukan sesuatu yang
dijalankan berkali-kali sambil mencari-cari, dan jangan dijalankan dari IP yang sama saat band
sedang mencoba masuk.

Kalau `SESSION_SIGNING_KEY` lupa dipasang, `/create` dan `/ws` menjawab `500 {"error":"NO_KEY"}`
dan `/health` menjawab `keyPresent: false`. Sengaja gagal tertutup: token yang di-mint dari kunci
kosong bisa dihitung ulang oleh siapa pun, jadi melayani sesi justru lebih bahaya daripada menolak.
Perilaku ini dijaga oleh tes di `src/worker/session.spec.ts`.

## Deploy spike ke akun sendiri (M0 lapangan)

Angka keputusan M0 hanya bisa diambil dari HP di tempat latihan, jadi spike ini harus hidup di
URL asli. Akun Workers Free cukup — tidak ada yang perlu dibayar.

```
npm run login                    # buka browser, otorisasi OAuth; cek: npx wrangler whoami
npm run check                    # 23 tes unit + 11 tes worker + typecheck, harus hijau
npm run secret                   # tempel satu baris hex 64, lihat catatan asal-usul di bawah
npm run deploy                   # = vite build && wrangler deploy; cetak URL workers.dev
curl https://paranoidclick.<akun>.workers.dev/health
```

Asal-usul kunci produksi: dibuat sendiri, tidak ada hubungannya dengan `.dev.vars`, dan tidak
pernah disimpan di file mana pun. Generate lewat terminal (bukan dengan `> .dev.vars`), tempel
ke prompt `npm run secret`, lalu lupa nilainya:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Buktinya bukan panjang string, tapi `keyPresent: true` di `/health`.

`wrangler.jsonc` sekarang mendeklarasikan `secrets.required: ["SESSION_SIGNING_KEY"]`, dan
dokumen Wrangler menyatakan `wrangler deploy` **gagal** kalau secret yang diminta belum terpasang
— jadi lupa `npm run secret` ketahuan saat deploy, bukan saat band sudah membuka HP-nya. Yang
sudah terbukti di mesin ini: wrangler 4.161.0 menerima properti itu (`--dry-run` jalan, tabel
binding menampilkan `env.CREATE_LIMITER (3 requests/60s)`), dan seluruh gerbang tes tetap hijau.
Yang **belum** terbukti: penolakan remote-nya sendiri, karena `--dry-run` tidak menanyakan apa pun
ke Cloudflare — itu baru terlihat pada deploy pertama.

Setelah deploy, tiga hal yang harus dicatat (bukan diasumsikan) — dua yang pertama sudah
terjawab pada deploy pertama di `https://paranoidclick.hafizsyq.workers.dev`:

1. **Plan Free menerima binding `ratelimits`?** Jawab: **ya, terbukti dua arah.** Deploy selesai
   tanpa penolakan dan tabel binding mencetak `env.CREATE_LIMITER (3 requests/60s)`, lalu T5a
   produksi benar-benar melihat `23` dari `30` `/create` pulang dengan `429`. Dokumen tetap tidak
   menulis gerbang plan untuk binding ini; satu-satunya syarat yang tertulis adalah Wrangler
   ≥ 4.36.0 (kita 4.161.0), jadi "free plan menerimanya" adalah hasil ukur satu akun, bukan
   jaminan yang bisa dikutip.
2. **Apakah log produksi menelan token?** Jawab: **ya, oleh platform, bukan oleh kita.** Jalankan
   di terminal A, lalu serang di terminal B:
   ```
   npx wrangler tail --format json > tail.log
   PC_BASE_URL=https://paranoidclick.<akun>.workers.dev PC_LOG_FILE=tail.log npm run attack
   ```
   Baris `T9c` menjawab `BUKTI`, dan angka-angkanya ada di bagian "Gerbang keamanan M0" di atas:
   URL lengkap tercatat tetapi nilainya `tok` diganti `REDACTED` oleh Cloudflare sendiri, 21 dari
   21 kemunculan. Catatan penting dari ukur yang sama: stream `wrangler tail` bocor (hanya
   sebagian entri sampai), jadi tes ini tidak boleh dibaca sebagai audit log.
3. **Angka lapangan.** Buka URL itu di **setiap** HP band, jalankan layar "Ukur 60 ping", salin
   kotak Hasil (jitter p95 per HP) ke tabel keputusan di atas. Satu HP bukan bukti lima HP.
   Ini yang masih belum ada angkanya.

Dua catatan Free plan yang sudah dijamin oleh dokumen, jadi tidak perlu diuji ulang: DO SQLite adalah
satu-satunya backend yang boleh di Free (Pricing, 18 Okt 2026) — kita memang memakai
`new_sqlite_classes`; dan total penyimpanan DO dibatasi 5 GB per akun (Limits, 7 Nov 2026),
sementara satu sesi di sini maksimum 12 anggota.

Rate limit-nya sendiri perkiraan, bukan angka pasti: "Rate limits are approximate and apply
separately in each Cloudflare location" (Rate Limiting, 12 Nov 2026). Artinya `3/menit` di T5a
adalah batas per colo tempat request mendarat, bukan batas global per IP. Kalau nanti butuh batas
yang benar-benar ketat, dokumennya suruh memindahkan limiter itu ke dalam Durable Object — belum
kita perlukan di M0.

**Jangan pakai URL sementara.** Host ini masuk ke QR, dan QR bisa tercetak atau tersimpan di
galeri HP orang lain. `wrangler deploy --temporary` dan URL preview mati sendiri, jadi HP yang
memindai QR basi akan mengarah ke endpoint yang sudah tidak ada. Satu host permanen, disalin dari
output `npm run deploy`, adalah satu-satunya yang boleh masuk app.
