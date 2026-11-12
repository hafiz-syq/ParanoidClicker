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
apa pun di-deploy ke band. Yang dibuktikan hari ini, beserta hasil sebenarnya:

| Tes | Yang dijaga | Hasil lokal |
| --- | --- | --- |
| T5a | 30 `POST /create` dari satu IP | 3 lulus, 27 → `429` |
| T5b | 30 `/ws` dengan sid karangan sendiri | 30 → `403`, DO tidak pernah tersentuh |
| T6a–c | frame 1 MB string, 500 kurung, frame 12 MB | `TOO_BIG`, `TOO_DEEP`, `TOO_BIG` |
| T6d | DO masih menjawab ping setelah semua bom | `pong` |
| T7a/b | `__proto__` di frame | `BAD_KEY`, tanpa noda di `Object.prototype` |
| T9a/b | payload dan token di log | tidak ditemukan di log dev |

T5b adalah tambalan yang ditemukan oleh tes ini, bukan oleh desain awal: rate limit `/create`
saja tidak mengikat, karena `/ws?sid=XXXX` yang ditebak sendiri sudah cukup untuk melahirkan
satu DO SQLite, dan ruang sid hanya 1.048.576. Sekarang `/create` mengembalikan `token`
(HMAC-SHA256 atas sid dengan `SESSION_SIGNING_KEY`) dan `/ws` menolak tanpa token yang sah —
gerbangnya pindah ke sebelum `env.SESSION` dipanggil.

Batas yang jujur: token itu ikut di query string WS, karena browser tidak bisa mengirim header
saat handshake. Ia kapabilitas sekali-pakai per sesi dan tidak menambah rahasia baru (sid-nya
sendiri sudah ada di URL yang sama), tetapi **`resumeToken` dan `leaderToken` tetap tidak boleh
masuk URL** (§15 T9), dan `wrangler tail` di produksi mencetak URL — itu belum diuji, baru bisa
dibuktikan setelah deploy.
