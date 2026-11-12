# ParanoidClick

Metronom sinkron untuk band Paranoid: beberapa HP mengikut satu tempo, HP yang membagi
QR jadi leader, lengkap dengan setlist dan hitungan suara.

Status: **spike M0** — mengukur RTT/jitter jaringan asli sebelum ada satupun fitur janji.

## Menjalankan

```
npm ci
cp .dev.vars.example .dev.vars      # token uji, bukan token produksi
npm run dev                         # worker di :8787 + vite di :5173
```

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
| `npx tsx scripts/smoke-ws.ts` | jalur WebSocket asli, butuh `npm run dev:worker` |

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
