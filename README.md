# ParanoidClick

Metronom sinkron untuk band Paranoid: beberapa HP mengikut satu tempo, HP yang membagi
QR jadi leader, lengkap dengan setlist dan hitungan suara.

Status: **M1b** — klik sudah berbunyi di beberapa perangkat dari satu grid tempo. Belum ada
otoritas pemimpin di server (M3), ramp/servo (M2), QR (M4), suara hitungan (M5), kalibrasi
akustik (M6), PWA (M7).

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

Buka http://localhost:5173 (atau :8787 untuk build yang sama seperti produksi). Dari menu di
halaman itu: **Buat sesi baru** jadi pemimpin (tautan join muncul di layar), tautan itu dibuka
di HP lain jadi pengikut. Alat ukur spike M0 masih di `?layar=ukur`.

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | worker lokal + app, dua-duanya |
| `npm run build` | bundel app ke `dist/` |
| `npm run preview` | build + sajikan lewat wrangler (paling mirip produksi) |
| `npm test` | logika murni (sinkron, grid tempo, batas frame, id) |
| `npm run test:worker` | Worker + Durable Object di runtime workerd asli |
| `npm run typecheck` | TS app dan TS worker |
| `npm run lint:arch` | `src/app/sync/` tetap murni: tanpa impor bare, tanpa API browser, tanpa layer lain |
| `npm run check` | keempatnya berurutan — gerbang sebelum commit |
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

### Hasil lapangan pertama (HP #1, 13 Nov 2026 07:19 UTC, sid `35GZ`)

Android + Opera, tab browser (`standalone=false`), 60 sampel dipakai 60, `rejected=0`, `lost=0`.

| angka | terukur |
| --- | --- |
| RTT p50 / p95 / max | 48 / 99 / 167 ms |
| **jitter p95 (w=8, k=4)** | **2,0 ms → lanjut: servo 4 tingkat cukup** |
| θ yang dipakai (`estimateOffset`) | 657 ms |
| estimasi bergulir per window | 655,5 … 664 ms — **rentang 8,5 ms sepanjang 60 detik** |
| θ satu sampel mentah | 586,5 … 690 ms — rentang 103,5 ms |
| delay terkecil per window | 14 … 18 ms (rentang 4 ms) |

Angka-angka di atas aku hitung ulang sendiri dari 60 stempel mentah dengan fungsi yang sama
yang dipakai app (`toSample`/`estimateOffset`/`estimateJitter`), dan reproduksi persis kotak
"Hasil" layar — jadi ini bukan membaca verdict-nya doang.

Tiga hal yang perlu dibaca dengan benar, karena angkanya menipu kalau dibaca cepat:

1. **θ 657 ms bukan keterlambatan jaringan.** Itu jam dinding HP itu yang ketinggalan sekitar
   setengah detik dari jam Cloudflare. Tidak masalah: setiap HP mengukur θ-nya sendiri terhadap
   satu jam server yang sama, jadi selisih jam tiap HP saling menghilangkan — selama yang
   dipakai adalah *fase*, bukan jam dinding.
2. **Rentang 103,5 ms di baris "θ satu sampel" itu sinyal yang dibuang, bukan sinyal yang
   dipakai.** Estimator median-dari-4-delay-terkecil duduk di 655,5–664 sepanjang run, dan
   estimasi kumulitiknya justru mengunci (655,5 → 657,0 dari sampel 10 ke 60). Yang membuat
   estimator setenang itu adalah jangkar delay terkecil: 14–18 ms, hanya bergerak 4 ms, walau
   RTT medianya 48 ms dan spikenya sampai 167 ms.
3. **Baris `10/60 θ=…` di log layar dulu mencetak sampel mentah** (`s.offsetMs`, bukan
   `estimateOffset(samples)`), jadi operator melihat 586 → 689 → 657 dan menyimpulkan sinkroni
   rusak padahal yang dilihat adalah noise yang memang dibuang. Verdict-nya sendiri selalu benar
   karena dihitung dari estimasi. Sejak commit ini layar mencetak
   `θ=<estimasi bergulir> (sampel <mentah>)` — keduanya, supaya yang mentah tetap bisa dilihat
   tanpa ditafsirkan sebagai angka penentu. **Ini mengubah app yang disajikan, jadi HP berikutnya
   baru melihatnya setelah `npm run deploy` ulang.**

Tiga yang **belum** terjawab, dan tidak bisa dijawab oleh run ini:

- **Satu HP bukan bukti lima HP.** Gerbangnya berbunyi "dari HP di tempat latihan", dan run ini
  adalah satu perangkat lewat internet seluler (RTT p50 48 ms bukan angka Wi-Fi venue). Empat
  HP lain, di ruangan tempat band benar-benar main, masih harus diukur.
- **Kalibrasi akustik belum pernah diukur sama sekali** — `audio: []` berarti tombol "Ukur audio"
  tidak pernah ditekan. Jaringan bilang 2 ms; yang menentukan terdengar-tidaknya click adalah
  latency keluar speaker HP (puluhan ms di Android) dan TWS/earbud BT yang dipakai satu orang.
  Angka 2 ms tidak menutupi itu sama sekali.
- **Wake lock ditolak perangkat**: `gagal: NotAllowedError: Wake Lock permission request denied`.
  Bukan dari kita — tidak ada `Permissions-Policy` di worker maupun aset, jadi penolakannya datang
  dari browser/perangkat (hemat baterai adalah sebab yang paling mungkin, dan itu belum kuukur).
  Run ini tetap bersih (t1 berjarak ~1000 ms, jadi CPU-nya tidak sempat tertidur), tapi itu
  keberuntungan 60 detik di tab yang sedang fokus, bukan jaminan lima menit di kantong. Kalau
  nanti pengukuran panjang menghasilkan spike saat layar mati, penyebabnya di sini — dan jawabannya
  menjadwalkan click dari jam Web Audio, bukan `setInterval`.

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

## M1a: grid klik dan keadaan sesi

Satu baris SQLite per sesi menyimpan `(bpm, anchorMs, running)`. `anchorMs` = waktu server saat
beat 0 jatuh; tiap HP menurunkan beat-nya sendiri dari pasangan itu ditambah θ hasil M0. Tidak
ada "tick" yang dikirim per beat, jadi satu frame yang terlambat tidak pernah menggeser klik
perangkat lain.

| Arah | Frame | Isi |
|---|---|---|
| klien → DO | `hello` `{sid, did}` | sama seperti M0 |
| klien → DO | `ping` `{nonce, t1}` | sama seperti M0 |
| klien → DO | `tempo` `{bpm}` | integer 30..300; selain itu dibalas `error BAD_BPM` ke pengirim saja |
| klien → DO | `start` / `stop` | tanpa isi |
| DO → semua | `state` `{bpm, anchorMs, running}` | tiap `hello` dan tiap perubahan |

Tiga keputusan yang membuat diff-nya kecil:

1. **Ganti tempo = ganti grid, bukan koreksi fase.** `retune()` di `src/shared/tempo.ts` memindah
   anchor ke batas grid lama berikutnya, jadi tidak ada klik yang hilang atau dobel di seam.
2. **Perubahan jatuh `LEAD_MS` = 300 ms di depan.** p95 RTT lapangan HP #1 = 99 ms, jadi frame
   sempat mendarat sebelum beat pertama grid baru jatuh.
3. **Keadaan dibaca dari tabel, bukan dari memori**, sama seperti hitungan member: DO boleh
   dievict di tengah lagu.

Sudah dibuktikan (14 Nov 2026, semua lokal): 6 tes matematika grid + 17 tes Worker hijau dalam
`npm run check` (exit 0); `hello` di workerd asli lewat WebSocket asli dibalas `welcome` lalu
`state bpm=120 running=false` (`npm run smoke`); `npm run attack` tetap lulus (9 OK, T9 SKIP
karena tidak ada log yang ditangkap). Penjaga `start` ulang diuji dengan melepasnya: tanpanya
tesnya merah, karena anchor bergeser dan baris SQLite tertulis dua kali — itu juga yang membakar
kuota "rows written" plan gratis.

BELUM ada waktu itu: satu HP yang membunyikan klik — ditutup di M1b di bawah. Yang masih terbuka:
otoritas pemimpin (siapa pun di dalam sesi boleh mengirim `tempo`/`start`/`stop` — ditutup M3),
dan batas laju perubahan keadaan. `proto` di `/health` naik 1 → 2; produksi masih serving proto 1
sampai deploy berikut.

## M1b: klik yang terdengar

Satu HP membuka sesi (pemimpin) atau masuk lewat tautan join (pengikut), lalu membunyikan grid
dari `anchorMs` tanpa mengirim apa pun per beat. Bagiannya: `src/app/sync/schedule.ts` aritmetika
murni (jam server → jam dinding → jam audio), `src/app/audio/click.ts` Web Audio + kompensasi
latensi + probe drift, `src/app/session/live.ts` klien sesi (θ bergulir, freewheel, backoff),
`src/screens/ClickRoom.tsx` + `Start.tsx` layarnya.

Enam keputusan yang tidak terlihat di diff tapi menentukan bunyi:

1. **`ClockBridge` membawa `rate`, bukan asumsi 1,00.** Terukur: `ctx.currentTime` tidak selalu
   berdetak secepat jam dinding (0,994–1,008× pada dua tab hari ini; spike headless terdahulu
   2,3×). Sebelum ini diperbaiki, pemimpin membunyikan **65 klik dalam ~11 detik pada 120 bpm** —
   scheduler menyangka jendela lookahead-nya masih panjang. Sekarang laju diukur ulang tiap ≥1 s,
   di-clamp 0,25..4, dan dipakai dua arah (pengali untuk menyetel, pembalik untuk mengukur drift).
   Jam audio yang sama sekali tidak maju ditandai `audioStalled` di diagnostik, bukan dipaksa
   menjadi laju 0,25 — angka laju lama lebih jujur daripada clamp bawah.
2. **Satu cursor: indeks beat berikutnya.** θ, rate, dan kompensasi boleh berubah kapan saja;
   yang disimpan hanya `nextIndex`, jadi tidak ada keadaan yang bisa saling bertentangan.
3. **Stop membungkam yang sudah disetel.** Beat di dalam jendela 120 ms sudah menjadi oscillator;
   `silence()` memanggil `stop(now)` supaya tombol Stop tidak melahirkan klik terakhir.
4. **Drift diukur, bukan diperkirakan.** `osc.onended` dibandingkan dengan waktu dinding yang
   diminta; operator yang bilang "klikku beda sendiri" sekarang punya angka p50/p95/max di layar.
5. **Ganti grid tidak boleh mengundur cursor.** `adoptIndex()` mulai dari beat berikutnya sesudah
   beat terakhir yang SUDAH disetel grid lama, jadi satu klik tidak pernah ditumpuki klik kedua
   pada waktu yang sama di jahitan tempo. Beat grid lama yang ditinggalkan lompatan itu dihitung
   `abandonedBeats` dan masuk ke `hilang` — tanpa itu, tab yang beku lalu menerima frame `state`
   melaporkan 0 hilang padahal seluruh lubang bunyi sudah dibuang di dalam adopsi.
6. **Frame `state` dari server melewati gerbang klien juga.** `bpm` wajib integer 30..300 dan
   `anchorMs` wajib berada dalam ±12 jam dari jam dinding HP; sisanya dibuang dengan
   `state cacat`. Server sudah membatasi angkanya, tapi kepercayaan tidak diwarisi: `bpm: 0`
   memberi periode tak hingga (klik bisu, nol error), dan anchor jam 2001 membuat scheduler
   menyisir jutaan beat sebelum menyentuh horizon.

Sudah dibuktikan (15 Nov 2026, dua tab Chromium + worker lokal `:8787`; semua angka dibaca oleh
sampler yang berjalan di dalam halaman, bukan dari DOM yang dibaca lewat round-trip):

| Yang diukur | Angka |
|---|---|
| panjang sesi pemimpin | 467 klik (sesi 1) & 303 klik (sesi 2), **0 hilang** |
| seam 120 → 125 bpm (`+5`) | jarak klik 500 ms → 480 ms; tidak ada selang ≈0 (klik ganda), tidak ada selang ≈2 periode (beat hilang) |
| 5 seam beruntun 120→121→122→127→128→133 | 0 hilang di kedua layar, `abandonedBeats` tidak menangis serigala |
| laju pada 125 bpm, jendela 40,3 s | 84 klik = **2,084 klik/detik** (harapan 2,083) |
| layar pengikut di latar selama 122,9 s | 245 klik, 0 hilang, nol selang > 900 ms, selang terpanjang 525 ms |
| probe drift pemimpin | p50 −0,2 … −2,1 · p95 7,4 … 8,2 · maks 9,2 ms (jendela 240 klik) |
| probe drift pengikut | p50 −0,8 · p95 8,0 · maks 9,9 ms |
| beda fase dua layar | anchor identik; θ +0,5 vs −0,5 ms → **≈1 ms** |
| Stop | 0 klik tambahan dalam 1,5 s sesudah tombol; kedua layar `running=false` |
| tombol pemimpin di layar pengikut | `-5 -1 +1 +5` dan `Start`/`Stop` semuanya `disabled` |
| `laju audio` yang terukur | 0,994–1,008× jam dinding |

`npm run check` hijau (exit 0): typecheck, `lint:arch` 2 berkas `src/app/sync`, **60 tes unit**
(17 di antaranya aritmetika jadwal — rate 2,5, jahitan, `adoptIndex`, `abandonedBeats`, grid
jahat) + 17 tes worker. `npm run smoke` lulus (rtt ≤ 8 ms, offset 0,00 ms) dan `npm run attack`
lulus di worker lokal (T5/T6/T7/T9).

BELUM / batas yang diketahui:

- **Teks diagnostik di DOM basi kalau dibaca lewat round-trip.** Counter `klik N` tertinggal
  beberapa detik saat tab berpindah; semua angka di atas diambil dengan sampler yang berjalan di
  dalam halaman. Ini alat ukur yang salah, bukan engine yang salah — tapi gampang menipu.
- **Tab yang tidak di-depan TIDAK melambat di Chromium ini** (245 klik / 122,9 s, 0 hilang).
  Angka itu bukan jaminan untuk HP: layar mati, iOS Safari yang membuang AudioContext, dan mode
  hemat baterai punya aturan sendiri, dan belum satu pun yang diukur di perangkat nyata
  (tugas lapangan M0 masih terbuka).
- **Satu lonjakan drift pernah terlihat**: maks 78,5 ms dan sekali 360,7 ms dalam jendela 240 klik,
  keduanya di sekitar pergantian tab, sementara p95 tetap < 8,2 ms. Kandidatnya `onended` yang
  terlambat di-dispatch (probe-nya JavaScript), bukan bunyi yang terlambat — belum dibuktikan.
- `abandonedBeats` menghitung lubang dari sisi grid yang sedang playing; satu beat grid baru yang
  tertelan antrean grid lama di jahitan tidak terhitung (yang itu tetap berbunyi dari antrean
  lama). Angka `hilang` bisa kurang satu klik per seam yang frame-nya mendarat >170 ms terlambat.
- Otoritas pemimpin masih cuma di sisi layar; server belum memeriksa siapa yang boleh mengirim
  `tempo`/`start`/`stop` → M3.
- Kompensasi latensi baru `baseLatency + outputLatency` (angka itu tidak ada di semua browser dan
  buta terhadap delay TWS/Bluetooth) → kalibrasi akustik M6; input manual sudah tersedia di layar.
- Belum ada servo: lompatan θ lebih dari setengah periode akan terdengar tertinggal sampai ping
  berikutnya menyetel ulang → M2.
- Join masih lewat tautan, belum QR (M4) — dan tautan itu sendiri adalah kunci sesi.
- Dua tab memakai satu profil browser → satu `did`, jadi "1 HP" di layar; penghitungan member
  tidak bisa dibuktikan dari browser (`shortcut:` sewa member baru ada di M3).
- `favicon.ico` 404 di dev: kosmetik, dibersihkan bersama ikon PWA (M7).

## Deploy spike ke akun sendiri (M0 lapangan)

Angka keputusan M0 hanya bisa diambil dari HP di tempat latihan, jadi spike ini harus hidup di
URL asli. Akun Workers Free cukup — tidak ada yang perlu dibayar.

```
npm run login                    # buka browser, otorisasi OAuth; cek: npx wrangler whoami
npm run check                    # typecheck + lint:arch + 60 tes unit + 17 tes worker, harus hijau
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
