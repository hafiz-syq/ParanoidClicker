# ParanoidClick

Metronom sinkron untuk band Paranoid: beberapa HP mengikut satu tempo, HP yang membagi
QR jadi leader, lengkap dengan setlist dan hitungan suara.

Status: **M2** — servo koreksi θ 4 tingkat, ramp tempo per bar, dan beat tertelan di jahitan
sudah berbunyi dan punya angka; belum otoritas pemimpin di server (M3), QR (M4), suara hitungan
(M5), kalibrasi akustik (M6), service worker + offline (M7). Semua angka M2 di bawah masih
**lokal** — tidak ada satu pun perubahan M2 yang dikirim ke produksi.

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
| `npm run cek:ikon` | versi CLI penjaga ikon (cetak tabel sha + IHDR); assertion-nya sendiri jalan di `npm run test` |
| `npm run cek:ikon:http` | versi served: `content-type: image/png` + sha256 body, butuh server; status 200 TIDAK dipakai sebagai bukti |
| `npm run cek:kontras` | versi CLI `scripts/cr.mjs` (cetak semua CR + penjaga kutipan); assertion-nya jalan di `npm run test` |
| `npm run check` | typecheck → lint:arch → test (100, termasuk 2 gerbang bukti di `scripts/gerbang.spec.ts`) → test:worker (20) — gerbang sebelum commit |
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
dengan teks `REDACTED` sebelum entri sampai ke kita.

**KOREKSI 16 Nov.** Versi paragraf ini menjahit dua jendela berbeda dalam satu kalimat, dan dua
angkanya tidak bisa diturunkan dari artefak mana pun. Yang ada di disk sekarang hanya tiga:
`prod-attack.log` 773 B, `tail.log` 454.711 B, `tail2.log` 433.156 B — gitignored lewat aturan
pemilik (`tail*.log`), jadi bukti ini memang hidup di luar git dan angka di bawah hanya bisa
diulang kalau berkasnya masih ada. Window yang dipakai **seluruh berkas**, bukan prefix byte.
Satu baris = satu perintah yang saya jalankan dan mencetak angka di kolom kanan:

| Angka | Perintah pada `tail.log` | Output |
|---|---|---|
| entri tercetak | `grep -c '"eventTimestamp":' tail.log` | 163 |
| jendela waktu capture | min/max `"eventTimestamp"` (epoch ms) | 2026-11-13T06:38:21.631Z … 07:37:32.039Z = 13 Nov 13:38–14:37 WIB |
| handshake `/ws` yang tercatat | `grep -oE '"url": *"[^"]*/ws\?[^"]*"' tail.log \| wc -l` | 33 |
| `tok=` di URL itu | `grep -o 'tok=' tail.log \| wc -l` | 33 |
| …semuanya hasil sensor platform | `grep -o 'tok=REDACTED' tail.log \| wc -l` | 33 |
| `tok` hex mentah | `grep -oE 'tok=[0-9a-f]' tail.log \| wc -l` | **0** |
| kendali positif: `sid` tetap tercetak | `grep -o 'sid=NCFB' tail.log \| wc -l` | 10, dari 14 sid unik di 33 URL `/ws` |
| header klien juga tercetak | `grep -o 'cf-connecting-ip' tail.log \| wc -l` | 88 = persis jumlah field `"url"` |
| status per path | `node -e` yang memasangkan `"url"` → `"status"` di entri yang sama | `/create` 200×18 + 405×2 + 429×26 · `/health` 200×5 · `/ws` 200×4 + 403×11 |

`tail2.log` (158 entri, 06:42:08Z … 07:37:32Z) bukan run kedua — itu instance `wrangler tail`
kedua yang jalan **paralel di capture yang sama**, buktinya entri terakhir keduanya punya
`eventTimestamp` yang identik sampai milidetik. Empat angka token-nya identik (33 / 33 / 0 dan
`sid=NCFB` 10). Karena jendelanya tumpang tindih, kedua berkas TIDAK boleh dijumlahkan.

Angka sisi penyerang tidak diambil dari log, tapi dari stdout script itu sendiri
(`prod-attack.log`): `T5a 30 create dari 1 IP → 7 lulus, 23 429` dan `T5b 30 sid palsu → status
unik 403`. Ditemani tabel di atas, tail menangkap 11 dari 30 percobaan sid palsu — inilah alasan
stream ini disebut best-effort, bukan audit log, dan klaim yang sah tetap "setiap kemunculan
token di stream ini disensor", BUKAN "tidak ada token di log". Untuk `resumeToken` /
`leaderToken`, yang belum pernah dikirim sama sekali, nol kemunculan tidak membuktikan apa pun.
Memindahkan token ke header juga tidak otomatis menyelamatkan log: entri tail ikut mencetak
request header, dan `cf-connecting-ip` tercatat 88 kali — sebanyak field `url`-nya.

Tiga angka dari versi lama yang saya nyatakan sendiri di sini, bukan dihilangkan diam-diam:
`tok= 21` tidak berasal dari jendela mana pun (whole-file 33, prefix 200.403 byte 10), `200 8x`
tidak juga (whole-file `/create 200×18`, prefix memberi `200×17`), dan `31 permintaan /create`
salah — `prod-attack.log` menulis 30. `sid=NCFB 10` dan `403 11×` yang tadi disebut "di jendela
ini" ternyata angka whole-file, sedangkan `200.403 byte / 42 field url / 42 cf-connecting-ip`
adalah jendela prefix; keduanya memang tidak pernah satu jendela. Yang bertahan utuh dari
kalimat lama cuma dua: `403` 11× dan `tok=hex` 0.

Atribusi rantai hex dikoreksi dengan cara yang sama. Di `tail.log` utuh ada **428** rantai
64 karakter, per field: `clientHandshake` 86, `serverHandshake` 86, `clientFinished` 86,
`serverFinished` 86, `durableObjectId` 84 (3 nilai unik). `tlsClientRandom` justru bukan hex —
44 karakter base64 — jadi "sisanya hash handshake TLS (96 hex)" salah dua-duanya. Dua dari tiga
`durableObjectId` bisa dipasangkan ke sid di entri yang sama (`87a6c836db96`→`B298`,
`e15fad11e8f6`→`NCFB`); yang ketiga (`5d773e62017a`, 62 kemunculan) tidak memuat sid di entri
yang sama, jadi pasangnya tidak saya klaim.

Serangan ini bukan tanpa jejak di akun sendiri. Sekali jalan di produksi, ia meninggalkan sesi
DO sungguhan dan membuat IP aslimu menyentuh `CREATE_LIMITER` selama 60 detik. Yang bisa
dibuktikan dari artefak di disk: `prod-attack.log` menulis `sesi uji sid=NCFB`, kedua tail
mencetak `sid=NCFB` 10 kali, dan `B298` juga punya DO sendiri di capture yang sama (10 kali,
`durableObjectId 87a6c836db96`). `7ND3` — yang disebut versi paragraf ini sebagai sesi
sebelumnya — **tidak muncul di artefak mana pun** yang tersisa, jadi angka itu saya tarik
kembali. Semua jejak di atas berasal dari capture **13 Nov 2026 13:38–14:37 WIB**, bukan dari
15/16 Nov: tidak ada artefak produksi pada dua tanggal itu, dan capture baru berarti
lalu-lintas sungguhan ke produksi — itu keputusan pemilik (S5, tabel alamat §KOREKSI), bukan keputusan
saya atau checker.
Kesimpulannya tidak berubah: `npm run attack` terhadap URL produksi bukan sesuatu yang dijalankan
berkali-kali sambil mencari-cari, dan jangan dijalankan dari IP yang sama saat band sedang
mencoba masuk.

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

Enam keputusan yang tidak terlihat di diff tapi menentukan bunyi, plus satu yang menentukan angka
di baris status:

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
   menyisir jutaan beat sebelum menyentuh horizon. `members` dibaca SEBELUM gerbang itu — jumlah HP
   informasi yang berdiri sendiri, dan membekukannya karena satu field tempo mencurigakan adalah
   variasi lain dari bug yang sama.
7. **Anggota baru disiarkan ke seluruh ruangan, bukan cuma ke yang masuk.** `members` ikut di frame
   `state` dan `live.ts` memanggil `onMembers` di jalur `state` juga: HP yang sudah duduk di ruangan
   tidak pernah `hello` ulang selama lagu, jadi kalau angkanya hanya lewat `welcome`, layar pemimpin
   membeku di `1 HP` selamanya. Siaran ini hanya jalan kalau `INSERT OR IGNORE` benar-benar menulis
   (`rowsWritten > 0`) — dua belas HP yang reload serentak tidak boleh mengirim dua belas frame ke
   ruangan yang sedang menghitung beat. Angkanya dibaca ulang dari `SELECT COUNT(*) FROM member`,
   bukan `total + 1` seperti di `welcome`, supaya orang ke-13 yang ditolak `FULL` tidak menambah
   satu HP hantu. `proto` di `/health` tetap 2: key ekstra diabaikan klien lama, dan klien baru
   tetap benar kalau server lama tidak mengirimnya.
   *(Koreksi ke depan, M3a: yang berubah bukan `proto` tapi **dasar angkanya** — `members` sekarang
   jumlah socket `OPEN`, bukan `SELECT COUNT(*) FROM member`; lihat bagian M3a dan
   [ADR-0006](docs/adr/0006-kursi-dari-socket-hidup.md). Kalimat di atas tetap tulisan M1b apa adanya.)*

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

`npm run check` hijau (exit 0; 9,1 s dan 9,2 s pada dua jalan berturut-turut, 7,2 s pada tree
sebelum T6 — naik ~2 s, dan tambahan itu TIDAK dipisahkan per langkah: suite worker sekarang 2,4 s
untuk 20 tes penuh vs 1,6 s kalau hanya satu tes ringan yang dijalankan, jadi seluruh isi suite
worker masih di bawah 1 s): typecheck, `lint:arch` 2 berkas `src/app/sync`, **63 tes unit**
(17 di antaranya aritmetika jadwal — rate 2,5, jahitan, `adoptIndex`, `abandonedBeats`, grid
jahat — 2 gerbang bukti `scripts/gerbang.spec.ts`: kutipan README + ikon kembar — dan 15 tes klien
sesi) + **20 tes worker**.
`npm run smoke` lulus (rtt ≤ 8 ms, offset 0,00 ms) dan `npm run attack`
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
- `abandonedBeats` menghitung lubang dari sisi grid yang sedang playing. **Ditutup di M2**: beat
  grid baru yang tertelan di jahitan sekarang punya angkanya sendiri (`jahitan` / `swallowed`,
  ADR-0003) dan serah terima grid ditunda sampai anchor (ADR-0004), jadi `hilang` tidak bisa
  lagi kurang satu klik per seam.
- Otoritas pemimpin masih cuma di sisi layar; server belum memeriksa siapa yang boleh mengirim
  `tempo`/`start`/`stop` → M3.
- Kompensasi latensi baru `baseLatency + outputLatency` (angka itu tidak ada di semua browser dan
  buta terhadap delay TWS/Bluetooth) → kalibrasi akustik M6; input manual sudah tersedia di layar.
- Belum ada servo: lompatan θ lebih dari setengah periode akan terdengar tertinggal sampai ping
  berikutnya menyetel ulang → M2.
- Join masih lewat tautan, belum QR (M4) — dan tautan itu sendiri adalah kunci sesi.
- Penghitung HP sekarang disegarkan oleh server — `members` ikut di frame `state` dan disiarkan
  begitu ada `did` baru masuk, jadi layar pemimpin tidak lagi membeku pada angka waktu ia masuk
  (buktinya di **Bukti di browser**, `bukti/b6-pemimpin-2hp.png`). Yang BELUM: angkanya adalah
  *riwayat orang yang pernah masuk*, bukan yang sedang terhubung — `webSocketClose` hanya menutup
  socket dan tidak menghapus baris `member`, jadi HP yang pulang tetap terhitung. Cara membaca
  angka itu diputuskan di M3 bersama otoritas pemimpin.
- Ikon: `paranoid-32.png` dipakai apa adanya di tab, dan OS menyusunkannya ke 16 px. Belum ada
  versi 16 px yang digambar ulang untuk ukuran itu, dan "Add to Home Screen" di HP asli belum
  diukur — lihat **Ikon & shell PWA**.

## M2: servo θ 4 tingkat, ramp per bar, dan angka jahitan

Empat keputusan ditulis di `docs/adr/`: [0001](docs/adr/0001-servo-empat-tingkat.md) servo 4
tingkat (bukan servo bebas), [0002](docs/adr/0002-ramp-tempo-per-bar.md) ramp = frame `tempo`
biasa satu langkah per bar, [0003](docs/adr/0003-adopt-index-ekor-antrean.md) `adoptIndex`
melaporkan beat yang tertelan, [0004](docs/adr/0004-serah-terima-grid-pada-anchor.md) grid baru
diambil alih pada anchor-nya. Tidak ada perubahan kontrak `state` di DO: `proto` tetap 2, tidak
ada kolom baru, tidak ada frame baru — klien lama yang sudah ter-install tetap memahami setiap
byte yang dikirim.

Yang baru di layar kedua peran: baris `θ dipakai klik = … ms · lompat N× · beat tertelan di
jahitan N` di panel diagnostik, dan satu baris **Ramp ke BPM / Mulai ramp** khusus pemimpin.

### Baseline pra-M2

Angka ini punya sesi pemeriksa (@ParanoidClicks), bukan aku — kutipan persis dari layarnya, belum
kuukur ulang di mesin yang sama, dan `max` pengikut memang tidak dilaporkan:

| Yang diukur | Angka persis |
|---|---|
| pemimpin | `klik 34 berbunyi · 0 hilang · ctx=running · laju audio=1.000×` · meleset **p50 0,9 / p95 1,5 / max 2,0 ms** |
| pengikut | `klik 18 berbunyi · 0 hilang · ctx=running · laju audio=0,993×` · meleset **p50 0,4 / p95 10,7 / max —** |
| kedua perangkat | `anchor=1794714006409` **identik**, θ −0,5 ms keduanya |
| environment | Chromium, viewport 390×844, dua `isolatedContexts`, worker lokal `:8787` |

### Sesudah servo (kuukur sendiri, environment-nya berbeda — jangan dibandingkan baris per baris)

Chromium 157.0.8103.51 lewat Playwright MCP, dua konteks terisolasi 390×844 `isMobile` + `hasTouch`,
app hasil `npm run build` disajikan `wrangler dev --assets=dist --local` di `:8788`. Semua angka
dibaca dari teks panel diagnostik di layar, bukan dari sampler di dalam halaman — jadi `klik N`
bisa tertinggal beberapa detik (batas yang sudah dicatat di M1b).

| Yang diukur | Pemimpin | Pengikut |
|---|---|---|
| 20 s pertama, 120 bpm | `klik 41 · 0 hilang · laju 0,997×` · p50 −6,1 / p95 3,8 / max 4,5 ms | `klik 40 · 0 hilang · laju 1,000×` · p50 4,4 / p95 5,0 / max 5,0 ms |
| θ vs θ yang dipakai klik | −0,5 vs −0,5 ms | +0,5 vs +0,5 ms |
| `lompat` / `tertelan` | 0× / 0 | 0× / 0 |
| ram 120 → 110 selesai | `110 BPM · ramp selesai di 110 BPM` · `klik 194 · 0 hilang` · p50 −2,7 / p95 4,5 / max 8,5 ms | `klik 193 · 0 hilang` · p50 3,8 / p95 4,8 / max 7,0 ms |
| anchor sesudah 10 jahitan | `1794720798569.0852` | `1794720798569.0852` (identik) |
| 24 s mantap di 110 bpm | **+44 klik** (harapan 44,0) · `0 hilang` → `0 hilang` · `tertelan` 0 → 0 | **+44 klik** · `0 hilang` → `0 hilang` · `tertelan` 0 → 0 |
| drift jendela 240 klik | p50 −0,4 / p95 4,9 / max 9,1 ms | p50 3,5 / p95 6,2 / max 7,9 ms |

Delta klik = 44 di kedua layar untuk 44 beat yang diharapkan adalah bukti live bahwa tidak ada
beat yang hilang **dan** tidak ada yang terdobel selama 10 jahitan ramp; `0 hilang` dan
`tertelan 0` menutup sisi yang lain.

### Kontrol pra-M2 di environment yang sama

Supaya angka "sesudah" tidak dibandingkan dengan angka dari mesin orang: `HEAD` (93f4d87, tanpa
servo/ramp) dibuild ke `dist/` di worktree terpisah dan disajikan di `:8789`, browser dan viewport
yang sama, 24 s pada 120 bpm.

| Yang diukur | Pemimpin | Pengikut |
|---|---|---|
| klik dalam 24 s | +48 (harapan 48,0) · `0 hilang` | +48 · `0 hilang` |
| meleset | p50 4,4 / p95 5,5 / **max 6,1 ms** | p50 −4,5 / p95 −4,2 / **max 51,0 ms** |
| kompensasi otomatis | 50,0 ms | 10,0 ms |
| anchor | `1794720920209` | identik |

Dua hal yang harus dibaca jujur dari tabel ini. (1) `kompensasi latensi` default adalah
`baseLatency + outputLatency` milik konteks itu sendiri, dan Chromium ini memberi 50 ms ke satu
konteks dan 10 ms ke konteks lain — jadi p50 absolut antar-run di mesin ini tidak sebanding
langsung, dan itu sebabnya p50−/p95 kontrol dan p50−/p95 M2 tidak bisa dikurangi menjadi "servo
memindahkan X ms". (2) Satu lonjakan `max 51,0 ms` muncul di kontrol pra-M2; aku **tidak**
mengklaim servo menghapusnya — penyebab lonjakan itu belum dibuktikan (dugaan terkuat tetap
dispatch `onended` yang terlambat, bukan bunyi yang terlambat) dan aku hanya punya satu run kontrol.

`npm run check` hijau sesudah M2 (exit 0): typecheck, `lint:arch OK — 4 berkas src/app/sync
bersih`, **100 tes unit** dalam 9 berkas (`servo.spec` 9, `ramp.spec` 11, `click.spec` 14,
`schedule.spec` 19, `live.spec` 16, `offset.spec` 13, `tempo.spec` 6, `limits.spec` 10,
`gerbang.spec` 2) + **20 tes worker**, 699 ms + 2,61 s.

Dua gerbang yang TIDAK ikut `npm run check` dijalankan terpisah, di worker lokal punya sendiri
(`wrangler dev --local --port 8790`, bukan server yang dipakai pemeriksa): `npm run smoke` →
10/10 sampel, 0 dibuang, **offset 0,50 ms**, rtts 1–2 ms, `sid` cacat ditolak; `npm run attack` →
9 OK (T6a/b/c bom payload, T7a/b prototype pollution, T6e tipe tak dikenal, T6d DO tetap hidup,
T5a 3 lulus dari 30 `/create` lalu 27 × 429, T5b 403 berstatus unik). `T9` tadinya SKIP dan
sekarang jalan karena `PC_LOG_FILE` ditunjuk ke log wrangler: **T9a lulus** (isi payload tidak
tertulis, 153 baris / 7705 byte) dan **T9b lulus** (token sesi tidak tertulis), tapi **T9c KOSONG**
— `wrangler dev --local` sama sekali tidak merekam URL, jadi "sid tidak muncul di log" di localhost
bukan bukti bahwa sid tidak bocor; yang terbukti cuma payload dan token tidak terserap log.
Kebocoran `sid` hanya bisa disimpulkan dari log produksi lewat `npm run tail`.

BELUM / batas yang diketahui di M2:

- Angka di atas diukur di **browser desktop**, bukan HP. `0 hilang`, anchor identik dan delta klik
  yang sama adalah jaminan pipa sinkron, bukan jaminan akustik di sepuluh HP.
- Jalur bangun-dari-tidur (`visibilitychange` → `pingNow()` + lompatan servo) belum pernah
  diuji dengan tab yang benar-benar dibekukan OS; yang teruji adalah unit test-nya.
- Ramp 120 → 110 butuh ±21 s dan 120 → 100 butuh **43,6 s** (20 bar, terhitung dari
  `4·60000/bpm`). Kalau band butuh lebih cepat, yang diubah ukuran langkahnya — itu keputusan UI,
  bukan arsitektur (ADR-0002).
  - Angkanya dihitung ulang dengan command, bukan dipegang dari kepala: 20 bar pada bpm
    120..101 = **43,558 s** dan 10 bar pada 120..111 = **20,792 s**. Batas waktunya cuma jumlah
    bar, karena server menaruh jahitan di awal bar — bukan di saat frame dikirim.
  - Satu-satunya hal yang bisa memanjangkannya: langkah yang tidak terlihat saat sebuah bar
    start masih kurang dari `LEAD_MS + bar/4` (= 425 ms di 120 BPM) dari sekarang akan menunggu
    bar BERIKUTNYA, jadi +0,5 s. Timer ramp berdenyut tiap `TICK_MS` = 25 ms (`ClickRoom.tsx`),
    jadi di atas kertas marginnya 17×; belum diukur pada tab yang benar-benar seret.
- Otoritas pemimpin masih di sisi layar saja → M3.

## M3a: otoritas pemimpin dijaga server

Dua keputusan ditulis di `docs/adr/`: [0005](docs/adr/0005-kunci-pemimpin-dari-create.md) — kunci
pemimpin `lk` dicetak terpisah di `/create`, rebut kendali hanya sah dengan tombol;
[0006](docs/adr/0006-kursi-dari-socket-hidup.md) — dasar hitungan `N HP` pindah dari riwayat SQL ke
socket hidup (ADR-0006 mengubah janji yang ditulis di M1b, makanya dia punya ADR sendiri). Kode:
`178e1e9` (tes ditulis GAGAL lebih dulu, RED-nya difoto dengan angka di pesan commit itu) lalu
`b9fc0f3` (kode §4 rencana M3a), dan dari ronde kedua: `297428a` (tes evict/hibernasi, MERAH) →
`a6ea775` (perbaikan + kunci jalur error). Tidak ada dependensi baru, tidak ada deploy, tidak ada
push, tidak ada perintah DDL ke produksi.

### Kontrak yang berubah di wire

| Yang lama | Yang sekarang | Di mana |
|---|---|---|
| `/create` → `{sid, token, wsPath}` | → `{sid, token, leaderKey, wsPath}`; `leaderKey` 64 hex hanya di JSON ini, `wsPath` (yang disalin ke tautan join, nanti jadi QR) tidak memuatnya | `src/worker/index.ts:39` |
| `tempo`/`start`/`stop` dari socket mana pun diterima | dijaga `assertLeader`; yang bukan pemegang podium dijawab `{t:'error',code:'NOT_LEADER'}` dan keadaan ruangan tidak tersentuh satu byte pun | `SessionDO.ts:198`, dipakai di `:291` (`tempo`) dan `:302` (`start`/`stop`) |
| tidak ada frame `claim` | frame masuk baru `{t:'claim', lk}` — `lk` diverifikasi ULANG dari frame, hasil `hello` tidak dipercaya; sah → `leaderDid` pindah + `state` disiarkan | `SessionDO.ts:209-219` |
| `members` = `SELECT COUNT(*) FROM member` (riwayat siapa yang pernah masuk) | `members` = jumlah socket `OPEN` di DO; angka itu sekarang bisa TURUN | `SessionDO.ts:169-174`, dipakai di `:120` (gerbang `FULL`), `:150` (`welcome`), `:256` (`state`) |
| `state` hanya disiarkan saat tempo/transport/perubahan anggota | `webSocketClose` ikut menyiarkan | `SessionDO.ts:325-337` |
| `leader` = peran dari URL | `leader` = punya `lk` DAN server belum menjawab `NOT_LEADER`; tombol "Ambil kendali" lahir dari penolakan itu | `ClickRoom.tsx:43-44`, `:62`, `:167`, `:315-318` |

Angka `SessionDO.ts:` di tabel ini diukur `grep -n` di atas `a6ea775`, bukan di `b9fc0f3`: perbaikan
hibernasi ronde kedua menulis 32 baris dan menghapus 15 (`git diff --numstat HEAD~1 HEAD --
src/worker/SessionDO.ts`), dan `grep -n` memindahkan `seatCount` 153 → 169, `assertLeader` 182 → 198,
`webSocketClose` 309 → 325 (+16 untuk ketiganya; catatan lama di tabel ini menulis `:310-319` padahal
barisnya mulai 309 — salah satu angka, sekarang dibetulkan). Angka baris yang tidak ikut disegarkan
adalah jejak yang salah tunjuk.

Isi frame `state` tidak bertambah dan tidak berkurang (`bpm`, `anchorMs`, `running`, `members`),
`proto` tetap 2, dan `src/shared/limits.ts` tidak disentuh: `FrameCode` adalah daftar penolakan
*BENTUK* frame, bukan daftar kode di wire, dan `live.ts` mencetak apa pun yang datang sebagai
`server menolak: <kode>`. Tabel `member` tetap ada — ia tidak lagi jadi dasar angka apa pun, kecuali `rowsWritten` di
`welcome`.

### Bukti dari stack hidup lokal

Command dan keluaran mentah, `wrangler dev --local` di `127.0.0.1:8787`. Yang diukur adalah `b9fc0f3`
plus dokumen B3 ini di working tree; jam ukur `node -e
"console.log(new Date().toISOString(), new Date().getTimezoneOffset())"` = 2026-11-16T19:09:46Z untuk
`curl` di bawah, dan 2026-11-16T19:25:20.891Z / 2026-11-16T19:33:33.724Z (offset `-420`) untuk rerun
gerbang sesudah dokumen:

```
curl -s -X POST http://127.0.0.1:8787/create
kunci=sid,token,leaderKey,wsPath  lenLeaderKey=64  lkDiWsPath=false
```

- `npm run check` hijau. Durasi `real` tiga rerun: **0m8.403s** di `b9fc0f3` bersih (19:09Z),
  **0m8.438s** dengan draf dokumen di tree (19:24Z), **0m8.321s** sesudah dokumen final (19:32Z) —
  yang tidak berubah adalah isinya: typecheck bersih, `lint:arch OK — 4 berkas src/app/sync bersih`,
  **103 tes unit** dalam 9 berkas (`live.spec` naik 16 → **18**, `gerbang.spec` 2 → **3**), **26 tes
  worker** di `session.spec.ts` (20 → 26; +5 otoritas, +1 siaran saat close).
- `npm run attack` hijau tanpa satu pun GAGAL, **real 0m2.098s** (run pertama) dan **0m3.404s**
  (rerun 19:25Z) — T6a/b/c/e/d, T7a/b, T5a/b, dan empat kasus baru:
  - **T12c** `/create` mencetak `leaderKey` 64 karakter, tidak ada di `wsPath`.
  - **T12s** 12 socket `hello` → 12 `welcome` + `state`: kursi dihitung dari koneksi nyata.
  - **T12a** 11 anggota × `tempo` → **11 `NOT_LEADER`**; siaran `state` di ruangan berjalan
    `12/11/10/9/8/7/6/5/4/3/2/1` sebelum dan sesudah serangan — **identik byte** di layar pemimpin.
  - **T12b** 100× `claim` tanpa `lk` → 100 `NOT_LEADER`; podium lama masih pegang kendali
    (bpm 118), penolakan naik 101 → 102 untuk satu `tempo` tambahan, dan teks state pemimpin tidak
    berubah.
- `PC_LOG_FILE=/tmp/pc-dev.log npm run attack`: **T9a/T9b/T9d OK** di atas log yang tumbuh dari 97
  baris / 4819 byte (run pertama) jadi 257 baris / 12839 byte (rerun — angka itu dihitung serangan
  sendiri di dalam log yang sama), dan `grep -ac "sid=\|tok=" /tmp/pc-dev.log` → **0** (exit 1).
  **T9c KOSONG** — `wrangler dev --local` build ini mencatat `GET /ws 101 Switching Protocols (29ms)`
  TANPA query string, jadi localhost memang tidak bisa membuktikan apa-apa tentang `sid`; buktinya
  tetap harus log produksi lewat `npm run tail`.
- `npm run cek:ikon` tetap `8 berkas, 6 rujukan, tidak ada kembar, semua sha+IHDR cocok` — M3a tidak
  menyentuh satu byte ikon pun, dan `scripts/gerbang-ikon.mjs` tidak diubah.

### Konsekuensi yang sudah terukur, bukan diduga

- **Kursi hantu.** Socket mentah tanpa dedupe `did`: yang ditolak `FULL` masih memegang satu
  koneksi, jadi satu HP yang flap/reload sebelum socket lama terdeteksi tutup memakan **2 kursi**.
  Terukur di `session.spec.ts:149`: ruangan dengan 12 HP nyata melaporkan `members: 13` ke
  `welcome`. Pertanyaan "dedupe per `did` unik?" sudah **SELESAI (S7)**: pemilik menjawab "Socket
  mentah" 16 Nov 16:57Z dan reaffirm "Tetap socket mentah" 20:36Z, setelah pilihan *"did unik"*
  yang dia sendiri beri 15 Nov (S2) dibatalkan — jadi angka `13` di atas bukan bug yang menunggu
  jawaban, dan tidak ada satu pun tes yang mengasumsikan dedupe. Yang tetap terbuka cuma ukurnya di
  lapangan: berapa sering flap itu terjadi di dua belas HP nyata (kotak `[ ]` §7, belum dikerjakan).
- **Gagal tertutup.** Tanpa baris `leader` tidak ada yang boleh memerintah. Konsekuensi hari deploy
  yang harus dibaca sebelum klien dikirim ke HP: HP yang sudah ter-install dan tidak mengirim `lk`
  masuk sebagai anggota biasa — termasuk HP pemimpin, karena `leaderKey` baru lahir hari itu.
  Sesi yang dibuatnya tidak pernah mengikat `did` apa pun, jadi seluruh `tempo`/`start`/`stop`
  miliknya dijawab `NOT_LEADER` sampai klien-nya diperbarui. Jalur pemulihannya ada di layar:
  "Ambil kendali" (`ClickRoom.tsx:315-318`) hanya muncul kalau HP itu memegang `lk`.
- `hello` pemimpin TIDAK menulis SQLite lagi kalau podium sudah terikat (`SessionDO.ts:141-143`):
  `claimed_at` tetap jam podium benar-benar direbut, dan reconnect tidak membayar kuota tulis.

### Ronde M3a #2 — DO yang tertidur tidak boleh merampas podium

Temuan checker, dan angkanya benar: `Map<WebSocket, Peer>` di memori instance adalah satu-satunya
tempat `ws → {sid, did}` hidup, sementara `fetch()` memakai Hibernation API (`SessionDO.ts:45`).
Sesudah DO di-evict, runtime memanggil handler dengan objek socket BARU yang tidak ada di Map itu,
jadi `assertLeader` DAN `claim` menjawab `NOT_LEADER` untuk pemimpin yang `lk`-nya sah. Artinya
janji yang tertulis di `live.ts:147-148` — "satu-satunya jalan kembali ke podium sesudah DO
berpindah tangan **atau ter-evict**" — dibayar oleh tombol yang tidak bisa bekerja
(`ClickRoom.tsx:315-318` → `live.ts:151`): buntu sampai orang itu me-reload halaman.

- Tes ditulis lebih dulu (`297428a`), MERAH-nya difoto sebelum satu byte kode disentuh:
  `npx vitest run --config vitest.worker.config.ts src/worker/eviction.spec.ts` →
  **2 failed | 2 passed (4)**, duration **4,07 s**, mulai 2026-11-16T21:11:12Z. Yang merah persis
  **A** (`tempo` sesudah evict) dan **B** (`claim` ber-`lk` sesudah evict), dua-duya dengan
  `expected [] to deeply equal [ { code: 'NOT_LEADER', t: 'error' } ]`; **C** (kontrol positif:
  `hello` ulang memulihkan kendali, kursi tetap 2) dan **D** (pagar: pengikut tanpa `lk` tetap
  ditolak di `tempo` maupun `claim`) sudah hijau — jadi yang gagal adalah cacatnya, bukan tesnya.
- Perbaikan (`a6ea775`): identitas hasil `hello` pindah ke **attachment socket** —
  `serializeAttachment` saat hello, dibaca lewat `peerOf()` di `assertLeader` dan `claim`
  (`SessionDO.ts:92-102`). Map dan `peers.delete` dihapus, bukan dipertahankan sebagai cache:
  dua tempat untuk satu fakta persis sumber cacat ini. `proto` tetap 2, isi frame `state` tidak
  berubah, `src/shared/limits.ts` tidak disentuh, `seatCount()` tetap memfilter
  `readyState === OPEN`.
- GREEN diukur sesudah kode: `npx vitest run --config vitest.worker.config.ts` → **31 passed
  (31)** = 27 `session.spec.ts` + 4 `eviction.spec.ts` (2026-11-16T21:15:25Z), dan `npm run check`
  → **EXIT=0**, `real 0m9.125s` (21:15:55Z → 21:16:04Z): typecheck bersih, `lint:arch OK`,
  103 unit + 31 worker.
- Serangan hidup sesudah perbaikan, dijalankan ulang barusan supaya angkanya bukan angka lama:
  `PC_BASE_URL=http://127.0.0.1:8791 PC_LOG_FILE=/tmp/pc-dev-r3.log npx tsx scripts/attack.ts`
  terhadap `npx wrangler dev --local --port 8791` (sid `VD2V`, exit 0) → **semua OK, nol GAGAL**:
  T6a/b/c/d/e, T7a/b, T5a (3 lulus / 27 × `429`), T5b (30 sid palsu → 403, dijawab Worker JSON),
  T12c (`/create` mencetak `leaderKey` 64 karakter, tidak ada di `wsPath`), T12s (12 socket hello
  → welcome + state), T12a (11 anggota × `tempo` → 11 `NOT_LEADER`; siaran kursi
  `12/11/…/2/1 → 12/11/…/2/1`, teks state pemimpin identik byte), T12b (100 × `claim` tanpa `lk`
  → 100 `NOT_LEADER`, penantang tetap ditolak 101 → 102), T9a/b/d.
- **T9c KOSONG dan lolosnya vacuous**, jadi batasnya ditulis di sebelah angkanya. Yang tercetak di
  run ini: `isi payload tidak tertulis di log (95 baris, 4795 byte)`, dan berkas yang sama diukur
  ulang dengan node → `{"jsChars":4795,"utf8Bytes":4897,"splitLines":95,"nonAscii":51}`: "byte"
  yang dicetak tes adalah `text.length` (satuan UTF-16), berkas di disk 4897 byte karena log
  wrangler punya 51 karakter non-ASCII, dan "95 baris" adalah `split('\n')` yang menghitung
  newline terakhir sebagai satu elemen kosong (`wc -l` = 94). Bukan regresi, cuma cara hitung yang
  harus disebut supaya dua orang tidak saling menuduh salah ukur.
  Yang dijaga T9a/b/d bukan angka itu, dan ia tetap lulus: `sid=` tidak muncul di log (0 kali) dan
  tidak ada token 64-hex di dalamnya. Sebaliknya itulah kesimpulannya: `grep 'GET /ws'` menghasilkan
  48 baris dan semuanya `GET /ws 101 Switching Protocols (…ms)` TANPA query string — logger ini memang tidak
  merekam URL, sehingga "sid tidak muncul di log localhost" TIDAK BOLEH dibaca sebagai bukti tentang
  log produksi; yang terbukti cuma payload dan token tidak terserap log. `sid` hanya bisa diuji dari
  log produksi lewat `npm run tail` (lihat angka capture 13 Nov di bagian M0).
- Yang ikut berubah dan harus disebut, bukan diselipkan: `baru` di `hello` sekarang dibaca dari
  attachment, jadi reconnect pada socket yang sama sesudah DO bangun tidak lagi dihitung hello
  pertama (sebelumnya iya, karena Map-nya ikut terhapus). Ruangan tidak menerima `state` ekstra
  untuk socket yang sudah dikenal — searah dengan janji "dua belas HP yang reload serentak tidak
  boleh mengirim dua belas frame", dan tidak ada satu pun assertion yang menuntut sebaliknya.
- **Yang belum terbukti:** bahwa evict ini terjadi di perangkat nyata. Yang dikirim klien tiap
  `PING_INTERVAL_MS = 1000` (`live.ts:32`) adalah **frame teks** —
  `ws.send(JSON.stringify({ t: 'ping', nonce, t1: slot }))` (`live.ts:278`) — jadi ia masuk lewat
  `webSocketMessage` dan membangunkan DO. Ini bukan control-frame RFC 6455, dan bedanya penting
  karena dokumen Cloudflare (di halaman `Use WebSockets`, terakhir diperbarui 30 Okt 2026, saya ambil
  2026-11-16T21:37:13.891Z) menulis *"Ping/pong handling does not interrupt hibernation"* dan *"This
  behavior keeps connections alive without waking the Durable Object"* — itu untuk frame ping
  protokol yang ditangani runtime, bukan untuk `{"t":"ping"}` kita. Selama ada klien berlayar depan,
  DO tidak pernah sempat di-evict, jadi evict di semua tes ini **dipaksa** lewat
  `evictDurableObject` API tes, bukan diamati. Skenario yang masuk akal — dan ini DEDUKSI, bukan
  ukur — dua belas HP terkunci di antara lagu, ping berhenti, DO tidur, bangun, dan pemimpin
  kehilangan podiumnya. Jalur pulih yang dijanjikan §6.3 (rebut dengan `lk` lewat tombol
  "Ambil kendali") sekarang benar-benar menutupnya, dan itu yang dites di **B**.
- **Lampiran checker menyusul setelah perintahnya**, dan satu langkah memang hilang dari versi saya
  sebelum berkas itu datang. Perbandingan `diff` antara lampiran
  `C:/Users/LENOVO/AppData/Local/Temp/pc-verify/src/worker/eviction.spec.ts` (117 baris) dan
  `src/worker/eviction.spec.ts` yang saya commit (150 → **158** baris sesudah langkah itu masuk):
  **154 baris berbeda**, jadi tidak ada satu byte pun yang saya salin dari worktree — sesuai
  syaratnya. Peta keempat tesnya ke tes saya: A ↔ **A**, B ↔ **B**, "hello ulang … jalur pulih" ↔
  **C**, dan "kursi (members) sesudah evict: apakah `getWebSockets` bertahan" (berkas mereka `:98`)
  juga **C** (`:128`), sementara **D** saya (`:138`) adalah tes fail-closed yang Anda bilang belum
  ada di berkas itu dan harus saya tambah sendiri. Yang hilang sebelum lampiran masuk: urutan
  bangkitnya DO lewat **socket pengikut** — di berkas mereka `q.kirim({t:'ping'})` di `:109`
  mendahului `hello` pemimpin. Versi saya membangunkan DO lewat socket pemimpin saja, yang masih
  membuktikan cacatnya tapi bukan urutan yang terjadi di ruangan sungguhan. Sekarang ikut di tes
  **C** (`eviction.spec.ts:120-122`): ping pengikut harus dijawab `pong` lebih dulu, baru `hello`
  pemimpin, dan `members` harus tetap 2. Ini **kontrol positif yang lahir setelah hijau**, bukan
  reproduksi MERAH — yang MERAH tetap A dan B di `297428a`. Ukur ulang sesudah langkah itu:
  `npx vitest run --config vitest.worker.config.ts src/worker/eviction.spec.ts` → **4 passed (4)**,
  2,82 s (EXIT=0), dan `npm run check` → **EXIT=0**, `real 0m9.387s`, 103 unit + 31 worker.
- **`.dev.vars` sintetis di worktree tidak mengubah apa pun, dan itu terukur, bukan diasumsikan.**
  Anda menyebut `lk` di worktree ditandatangani dengan kunci yang dibuat di sana, bukan salinan tree
  utama. `lk` di semua tes ini tidak pernah diketik tangan: ia keluar dari `/create` di proses yang
  sama dan diverifikasi dengan kunci yang sama, jadi nilai kuncinya tidak bisa memilih hasil — dan
  buktinya adalah RED yang identik di dua tempat: **2 failed | 2 passed (4)** di worktree Anda, dan
  **2 failed | 2 passed (4)** yang saya reproduce di tree utama dengan kunci `.dev.vars` sungguhan.

### TEMUAN 2 ronde kedua: ditutup dengan bukti, bukan dengan diam

`webSocketError` (`SessionDO.ts:339-342`) tidak menghapus keadaan dan tidak menyiarkan apa pun —
gejalanya persis penyakit T6 di jalur `close`. Pertanyaan penentunya bukan "perlu tidak ya
beres-beres di situ", tapi "apakah `webSocketClose` sungguh menyusul". Dokumen vendor cuma bilang
*"invoked upon disconnect"*, jadi runtainya diukur: sebuah probe sementara (sengaja tidak
di-commit; yang di-commit adalah tes penguncinya) membungkus `instance.webSocketClose` dengan spy,
lalu memanggil `instance.webSocketError(socket, err)` di dalam `runInDurableObject`:

```
PROBE ERROR {"sebelum":{"jumlah":2,"kursi":2},"sesudahJumlah":1,"sesudahOpen":1,"readyStateSoketYangError":3,"dipanggil":["webSocketClose"],"frameB":[{"t":"state","members":2},{"t":"welcome","members":2},{"t":"state","members":2}],"frameA":[{"t":"welcome","members":2},{"t":"state","members":2},{"t":"state","members":2},{"t":"state","members":1}]}
```

Bacaannya: runtime **menyusulkan** `webSocketClose` satu kali sesudah `ws.close(1011)` dari sisi
server, `getWebSockets()` turun 2 → 1 dengan `readyState` 3 (CLOSED), dan HP yang masih di dalam
(`frameA`) menerima `state` dengan kursi yang **sudah** turun. Karena beres-beres itu memang
terjadi, `webSocketError` sengaja tidak saya tambahi `broadcast` sendiri — itu mengirim dua frame
identik untuk satu kesalahan. Temuan ini closed sebagai **bukan defect**, dengan kunci supaya
perubahan vendor ketahuan: `session.spec.ts:610`
`webSocketError menurunkan kursi karena webSocketClose menyusul, bukan karena diam` memilih socket
korban lewat attachment (bukan `sockets[0]`, urutan `getWebSockets()` tidak dijamin) dan menuntut
frame `state members: 1`. Rantai yang sama tercatat di
[ADR-0007](docs/adr/0007-attachment-identitas-socket.md).

### Ronde M3a #3 — pagar yang lulus tanpa membaca jawabannya, dan `did` yang ikut memerintah

Dua temuan baru dari pemeriksa (basis ukur `343a020`), keduanya terukur di dua mesin: satu oleh dia di
worktree `pc-verify3`, satu oleh saya di worktree `pc-exec-r3` (detached HEAD `343a020`, `node_modules`
junction ke tree utama, `.dev.vars` sintetis 64 hex nol yang saya tulis di sana — bukan salinan tree utama,
bukan rahasia, dan berkas itu gitignored).

**TEMUAN 5 — tes D selama ini lulus tanpa pernah membaca jawaban `claim`.** `cari()` memindai `frames` dari
indeks 0, dan dua baris di atas assertion claim sudah memproduksi satu `NOT_LEADER` dari penolakan `tempo`.
Probe P1 pemeriksa, lalu saya reproduce:

```
P1 NOT_LEADER sebelum claim = 1; frame baru sesudah claim = [{"t":"error","code":"NOT_LEADER"}]
P2 frame baru sesudah claim tanpa lk = [{"t":"error","code":"NOT_LEADER"}]
```

Perilakunya benar (P2: jalur claim tertutup sendiri, nol `state`); yang cacat pagarnya. Perbaikan test-only
di `a99a1a4` (`src/worker/eviction.spec.ts`, +15/−2, nol `src/worker/SessionDO.ts`): jendela diambil dengan
`sejak(dasar)` sesudah `tempo` ditolak (`:151`), lalu dua assertion baru — TEPAT SATU `error NOT_LEADER`
(`:159-162`) dan NOL `state` di jendela itu (`:163-166`). Assertion lama `bpm 180 tidak pernah disiarkan`
(`:167`) tetap tinggal untuk jalur tempo. Ukur sesudah perubahan, di tree utama:
`npx vitest run --config vitest.worker.config.ts src/worker/eviction.spec.ts` → **EXIT=0, 4 passed (4)**,
`Duration 5.31s (tests 4.01s)`.

**Gerbang mutasi 5b — dan bagian yang TIDAK bisa saya penuhi seperti yang diminta.** Mutasi yang diminta
pemeriksa adalah `claim` menerima frame tanpa `lk` (fail-open). Edit bentuk itu saya coba dua kali di
worktree terisolasi dan **ditolak permission layer**; pesan keduanya:

```
Auto mode: action blocked by classifier — [Security Weaken] Edit modifies SessionDO.ts to allow
empty-string leader keys to bypass cryptographic verification
```
```
… [Security Weaken] … Under the HARD BLOCK rules, disabling security mitigations or adding ways to
bypass them cannot be cleared by user intent.
```

Kalimat kedua itu eksplisit: kotak persetujuan tidak membukanya. Saya sudah bertanya lewat AskUserQuestion
di sesi ini dan jawabannya "Bolehkan mutasi fail-open di worktree" — jawaban itu dulu tidak saya tulis sebagai
alamat karena jamnya tidak saya ukur saat mendarat; **ronde #4 mengukur jamnya sendiri** di transkrip sesi ini:
baris 16130, `type: user` dengan `tool_result` `tool_use_id call_3ce2b742e1e6443bad8ba78b` pada
`2026-11-16T22:09:35.300Z` (`via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-16T22:09:35.300Z`), dan dua catatan
blokir mengapitnya di baris 16122 (`22:08:12.998Z`) dan 16136 (`22:09:54.406Z`). Angka yang dirolay checker untuk
dua blokir itu — `22:08:13.002Z` dan `22:09:54.408Z` — tidak ada sebagai field `timestamp` di transkrip saya
(`grep -c` = 0 untuk kedua bentuk), selisihnya 2–4 ms; yang ditulis di dokumen adalah yang terukur.
Gerbangnya tetap tidak terbuka karenanya, dan saya tidak
mengakali bentuk yang sama (tidak menulis lewat `sed`, tidak menaruh mutan di berkas lain). Yang saya ukur
sebagai gantinya adalah **dua mutan yang tetap menolak dan tidak memindahkan podium**:

```
M1 jalur tolak claim menjawab dengan code 'INTERNAL' (penolakan tetap ada, label salah)
M2 jalur tolak claim mengirim NOT_LEADER lalu membocorkan satu siaran state

M1 + D lama  → EXIT=0  4 passed (4)      ← INI bukti pagar lama vacuous: mutan lolos
M1 + D baru  → EXIT=1  1 failed | 3 passed (4)   Duration 5.29s
   AssertionError: claim tanpa lk harus dijawab TEPAT SATU NOT_LEADER,
   dapat [{"t":"error","code":"INTERNAL"}]: expected +0 to be 1     eviction.spec.ts:162:5
M2 + D baru  → EXIT=1  1 failed | 3 passed (4)   Duration 5.36s (D 1329ms)
   AssertionError: claim tanpa lk tidak boleh menyiarkan apa pun,
   dapat [{"t":"error","code":"NOT_LEADER"},{"t":"state","bpm":120,"anchorMs":null,"running":false,"members":2}]:
   expected 1 to be 0
session.spec.ts di bawah M1 → 1 failed | 26 passed (27), Duration 3.07s
   `claim dengan lk memindahkan podium, claim tanpa lk tidak menggeser apa pun` (:537) jatuh di :553
session.spec.ts di bawah M2 → 1 failed | 26 passed (27)
   tes yang sama, jatuh di :555 — `expected [ 5, 4 ] to deeply equal [ 4, 3 ]`
pulihkan SessionDO.ts (worktree) → EXIT=0  4 passed (4), tests 4037ms
pulihkan + jalan kedua berkas worker (worktree) → EXIT=0  31 passed (31), Duration 5.46s
```

Yang dijamin angka di atas: jendela claim yang dibaca D benar-benar jendela claim (M1 dan M2 masing-masing
menjatuhkan satu sisinya), dan **jalur claim pra-evict sudah dijaga `session.spec.ts:537` — dugaan pemeriksa
di 5c sekarang ukuran, bukan dugaan**: tepat satu tes yang merah di bawah kedua mutan, 26 sisanya hijau.
Jalur pasca-evict tidak dijaga apa pun sebelum `a99a1a4`. Yang TIDAK dijamin: fail-open sungguhan — mutan
saya tidak memindahkan podium, jadi D masih belum pernah dilihat merah karena podium pindah. Kalau
pemeriksa punya jalur mutasi yang tidak terbendung hard-block, itu gerbang yang masih bolong.

**TEMUAN 4 — sesudah podium terikat, `did` ikut membawa otoritas, dan itu bukan regresi `a6ea775`.** Satu
baris penyebabnya (semua nomor di paragraf ini adalah `343a020`, dan sudah TIDAK berlaku lagi di `f383335`
— ekuivalennya di kurung): `SessionDO.ts:200` (`:222`) `if (peer && this.leaderDid() === peer.did) return true`,
sementara
`did` diambil dari frame `hello` (`:107` → `:117`, server cuma menjaga panjang 1–32: `:110` → `:120`). Probe P3 saya jalankan sendiri
dan mencetak kesimpulan yang sama dengan pemeriksa, di ruangan berbeda:

```
P3 welcome peniru = {"t":"welcome","sid":"7TS5","did":"lead0013","serverNow":1794867241599,"members":2,"rowsWritten":0}
P3 frame baru untuk peniru ber-did sama = [{"t":"state","bpm":177,"anchorMs":null,"running":false,"members":2}]
P3 tempo 177 diterima tanpa lk = true
```
(3 passed (3), EXIT=0, 3878ms di `pc-exec-r3`; pemeriksa mengukur 3 passed, 3944ms dengan sid `JRX5`.)

Asal-usulnya saya ukur di git: baris pembandingan yang ada di `git show b9fc0f3:src/worker/SessionDO.ts`
pada `:184`, dan `178e1e9` belum punya `assertLeader`/`leaderDid`/`NOT_LEADER` sama sekali (`grep -c` = 0) —
jadi ini perilaku yang lahir bersama otoritas, bukan sesuatu yang dibawa perbaikan attachment. Prasyaratnya
juga saya ukur, supaya tidak digembalkan dan tidak dikecilkan: `did` = 8 byte acak → 16 hex
(`genDid()`, `src/shared/ids.ts:32-36`) di `localStorage` (`live.ts:295`); **tidak pernah disiarkan**
(`welcome` hanya ke socket pengirim, `SessionDO.ts:144-153` → `:162-171`; `state` tidak memuat `did`, `:251-257` → `:274-280`;
`grep -rn "\bdid\b" src/screens` = 3 baris dan tidak satu pun menampilkan `did` pemimpin
(`ClickRoom.tsx:35`, `:61` = komentar, `DebugScope.tsx:205` = pengiriman `hello`). Jadi pemegang `sid`+`tok`
allein tidak memakai jalur ini; yang bisa memakainya adalah pihak yang sudah tahu `did` pemimpin — HP dipakai
bersama, akses fisik, XSS, atau DevTools di HP pemimpin. Batas + dua model otoritas waktu itu masih [TANYA]
dan ada di [ADR-0005](docs/adr/0005-kunci-pemimpin-dari-create.md) bagian "Batas yang terukur di
ronde M3a #3". Ronde itu saya tutup tanpa menulis tes untuk salah satu model: tes untuk (a) mengunci perilaku
yang mungkin dibalik, dan tes untuk (b) memang masih merah — **ronde #4 menjawabnya (b), dan tes E-nya ada di
bagian berikutnya**; probe P1/P2/P3 tetap tinggal di worktree, tidak di-commit.

**Rumah tangga — dua pendengar lokal, bukan satu.** Yang pemeriksa sebut cuma `15440` di 8787. `netstat`
menemukan dua: `TCP 127.0.0.1:8787 LISTENING 15440` (workerd, sisa ronde sebelumnya — saya probe: `HTTP=000`
setelah timeout 4 s, memang zombie) dan `TCP 127.0.0.1:8791 LISTENING 17856` (workerd server saya untuk
serangan T9c yang segar — `HTTP=200`). Akar keduanya `node.exe … wrangler … dev --local --port 8787|8791`
dari `node_modules` proyek ini (PID 15244 dan 9736), jadi yang saya matikan adalah pohonnya, bukan hanya
workerd-nya:

```
taskkill //PID 15244 //T //F → 6 baris SUCCESS (15244, 15440, 10004, 11352, 18480, 1420)
taskkill //PID 9736  //T //F → 6 baris SUCCESS (9736, 13644, 17856, 25420, 528, 11360)
netstat -ano | grep -E ":(8787|5173|879[0-9]).*LISTENING" → (kosong) "tidak ada listener dev yang tersisa"
```

Tidak ada proses sesi lain yang saya sentuh; kedua pohon itu punya `CommandLine` milik proyek ini dan saya
yang memulai keduanya.

### Ronde M3a #4 — `S8` dijawab (b): bukti `lk` ikut pindah ke attachment, dan punya tes sendiri

Pemilik menjawab `S8` via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T23:06:05.165Z dengan
**"(b) Ikat ke lk terverifikasi"** — opsi (a) (menerima "`did` yang cocok = boleh memerintah" lalu menguncinya
sebagai desain) tidak dipilih. Isi keputusannya, dua model apa adanya, dan perubahan perilakunya ada di
[ADR-0005](docs/adr/0005-kunci-pemimpin-dari-create.md) bagian "Batas" + "Dua model"; tempat
penyimpanannya ada di [ADR-0007](docs/adr/0007-attachment-identitas-socket.md) bagian "Perpanjangan". Basis
ukur ronde ini: HEAD `0967b4e`, dua commit, urutan B1 dijaga (tes MERAH dulu, baru kode, lalu dokumen):

```
73464b2  test(M3a): tes E …   src/worker/eviction.spec.ts  +92/−1   ← nol kode produksi
f383335  fix(M3a): S8-b …     src/worker/SessionDO.ts      +31/−8   ← nol berkas produksi lain
```

**RED.** Dijalankan di `0967b4e` sebelum satu baris `SessionDO.ts` pun berubah:

```
npx vitest run --config vitest.worker.config.ts src/worker/eviction.spec.ts
EXIT=1   1 failed | 4 passed (5)   Duration 8.27s
  E — socket ber-did pemimpin tanpa lk tidak boleh memerintah, sebelum maupun sesudah evict
  AssertionError: fase 1 (sebelum evict): peniru ber-did sama tanpa lk harus DITOLAK, bukan dilayani,
  dapat [{"t":"state","bpm":177,"anchorMs":null,"running":false,"members":2}]:
  expected 'state' to be 'error'                                    eviction.spec.ts:220:7
```

E sengaja dibuat lebih keras dari probe P3 pemeriksa, karena perintahnya "jangan salin byte dari worktree
saya": peniru (socket kedua, `did` pemimpin dikarang dari frame, tanpa `lk`) harus dijawab TEPAT SATU
`error NOT_LEADER` **dan** NOL `state` di JENDELANYA SENDIRI (`nungguDalam(dasar, …)`, pelajaran TEMUAN 5:
`cari()` memindai dari indeks 0), lalu NOL `state` di jendela pemimpin sah — jadi yang dituntut bukan cuma
"peniru ditolak" tapi "bpm 177 tidak pernah sampai ke SIAPA PUN". Fase yang sama diulang sesudah
`evictDurableObject` dengan `bpm 188`, angka kedua tidak pernah muncul di riwayat kedua socket, dan ada dua
kontrol positif (`tempo 140` sebelum serangan, `tempo 199` sesudah dua penolakan) supaya implementasi
"semua orang ditolak" tidak bisa lulus sebagai perbaikan.

**HIJAU.** Diukur ulang setelah `f383335`, satu perintah penuh (bukan hanya berkas E):

```
npx vitest run --config vitest.worker.config.ts        → EXIT=0  32 passed (32)  Duration 9.40s
   src/worker/eviction.spec.ts   5 tests  5251ms   A 1367ms  B 1308ms  D 1296ms  E 1103ms
   src/worker/session.spec.ts   27 tests  2601ms   ← berkasnya tidak saya sentuh sama sekali
```

Yang hijau itu bukti dua hal sekaligus: (b) tidak memecah 27 tes `session.spec.ts` yang lama (dugaan
pemeriksa, sekarang ukuran), dan flag `lkDibuktikan` ikut terbangun ulang lewat
`serializeAttachment`/`deserializeAttachment` — karena A dan B keduanya melewati jalur yang sekarang menuntut
flag itu sesudah evict.

**Kontrak tidak disentuh, dan itu saya ukur, bukan saya klaim:** `proto` tetap 2 (`src/worker/index.ts:25`);
`src/shared/limits.ts` tidak berubah (`git diff --numstat 0967b4e..HEAD -- src/shared/limits.ts` kosong);
`tempo`/`start`/`stop` tetap TIDAK membawa `lk` maupun `did` — `SessionDO.ts:314` dan `:325` cuma memanggil
`assertLeader(ws)`; `seatCount()` tetap socket OPEN (S7); `webSocketError` tetap diam (`:362-365`).
Ukuran attachment (panjang `JSON.stringify` dari nilai yang benar-benar ditulis, `node -e` 2026-11-17):
`{sid, did}` = **39 byte**, `{sid, did, lkDibuktikan}` = **59 byte**, **75 byte** pada bentuk terbesar yang
masih diterima server (`sid` dipaksa 4 karakter oleh `isSid` di `src/shared/ids.ts:16-18`, `did` ≤ 32 di
`SessionDO.ts:120`); batas vendor 16.384, dan tidak ada kunci di dalamnya — yang disimpan cuma hasil
verifikasi, satu boolean.

**Flag-nya tidak lengket, dan itu pilihan yang harus disebut:** `hello` tanpa `lk` menulis `false`
(`SessionDO.ts:144-145`), jadi socket yang pernah membuktikan kunci kehilangan hak memerintah begitu ia
`hello` ulang tanpa kunci. Harganya: klien yang kehilangan `lk` dari `localStorage` kehilangan kendali pada
`hello` berikutnya. Itu persis cabang "Ambil kendali" — dan **cabang itu belum terukur di browser**:
`src/screens/**` dan `src/app/**` tidak saya ubah dan tidak saya jalankan ronde ini, jadi tidak ada satu pun
kalimat di atas yang boleh dibaca sebagai "layar sudah diuji".

**Yang TETAP belum terukur oleh siapa pun, dan tidak berubah karena ronde ini:** fail-open `claim` yang
sungguhan. Bentuk editnya diblokir permission layer dua kali di sesi saya, dan pemeriksa menulis sendiri di
ronde #4 bahwa edit mutasi mereka di `SessionDO.ts` kena blok yang sama — jadi tidak ada yang boleh menulis
"checker mengukur mutasi server". Yang mereka punya adalah kontrol positif **di tingkat assertion**
(`pc-v4-pagar.cjs`, di worktree mereka, tidak di-commit): pagar lama LULUS untuk ketiga kasus (vacuous), pagar
baru MERAH untuk fail-open yang **disimulasikan** dan untuk M1. Label SIMULASI itu dari mereka; angkanya tidak
saya jalankan ulang, dan tidak saya tulis sebagai angka saya.

### BELUM di M3a

- Gerbang rencana §7 "ukur di stack hidup DUA perangkat": **sebagian tertutup, dan yang tersisa
  bukan pekerjaan yang bisa saya kerjakan sendirian.** Angka-angka di bawah ini **dilaporkan checker
  di prompt ronde M3a #2 dan tidak saya ukur ulang** — sumbernya pelapor, bukan alat saya
  (Chromium 390×844, dua `isolatedContext`, vite 5173 → proxy 8787, sid `ABVQ`, pemimpin
  `did 4b05e094864ca995`, pengikut `did f992decd4ce73998`): `grid: bpm=130 anchor=1794862553748
  running=true` **identik di kedua layar**, sebelum dan sesudah pengikut me-reload; pengikut
  "klik 55 berbunyi · 0 hilang · ctx=running · laju audio=1.000×", θ −0,5 ms, meleset p50 1,5 /
  p95 9,0 / maks 360,5 ms (54 klik; maks = klik pertama pra-M2, bukan regresi); sesudah tab
  pengikut ditutup, pemimpin melihat 1 HP di sampel poll pertama dan "klik 202 berbunyi · 0 hilang",
  p50 1,0 / p95 9,0 / maks 410,0 ms (201 klik). Jadi `bpm`/`anchor` identik, `0 hilang` tidak
  berubah, dan `N HP` TURUN sudah punya bukti dua perangkat.
- Yang MASIH BELUM dari gerbang yang sama: **`NOT_LEADER` terlihat di layar pengikut**, karena UI
  pengikut tidak pernah mengirim frame perintah — tombolnya `disabled`, dan sesudah `disabled`
  dilepas tangan yang hasilnya cuma `{"t":"ping"}` yang terkirim. Penjaga server terbukti di kawat
  (`T12a`) dan tidak terbukti di layar, dan itu dua hal berbeda; kalimat §7 menuntut yang kedua.
  Apakah butir §7 perlu diformulasikan ulang ("jalur UI-nya memang tidak ada, jadi yang diuji di
  kawat") atau perlu jalur UI baru supaya penolakan itu bisa terlihat — [TANYA] untuk checker/pemilik;
  saya berhenti di sini dan tidak menjawabnya sendiri.
- Setlist (tabel, layar, frame-nya sendiri) keluar ke **M3b** — bukan pekerjaan yang tertinggal.
- QR menyusul di M4; sampai itu terjadi, tautan join tetap kunci ruangan: siapa pun yang membukanya
  bisa masuk, dan hari ini ia masuk sebagai anggota.
- M3a **belum LULUS penuh, dan sejak ronde #4 alasannya cuma satu: gerbang §7 yang butuh dua perangkat nyata
  (butir pertama di atas), bukan kode.** Pemeriksa menyatakan butir 1/2/3 LULUS atas ukuran yang dia ambil
  sendiri di `343a020`. Alamat prompt ronde M3a #3 sekarang ada — `2026-11-16T21:59:25.427Z`, turn
  `agent-message:f1323ddc0699ea1a499dea7d995fc0467a37ca92faae3b3d8dccf1e78517541a` — tapi statusnya harus
  disebut apa adanya: angka itu **dilaporkan checker**, dan yang bisa saya ukur di transkrip saya sendiri
  cuma keberadaan string `21:59:25.427Z` di dalam berkas (baris 3735, jam baris itu sendiri
  `23:00:22.054Z`), bukan bahwa ia field jam-kirim. Jadi ia bukan alamat yang saya verifikasi; lihat plan
  §8.3. Pagar D (TEMUAN 5) sudah ditutup lebih dulu: LULUS diukur checker atas `a99a1a4` + `343a020`, dan
  check EXIT=0 mereka di 22.862s.
- Yang menahan M3a di awal ronde, TEMUAN 1, sudah TUTUP (`343a020`). Yang tadinya menahan sebagai
  **TEMUAN 4 — model otoritas sesudah podium terikat — juga sudah tertutup ronde ini:** `S8` dijawab pemilik via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T23:06:05.165Z
  dengan "(b) Ikat ke lk terverifikasi"; opsinya (a) ditolak, dan jawabannya sudah jadi kode (`f383335`) + tes
  sendiri (`E`, lihat bagian ronde #4 di atas) + dokumen (ADR-0005 "Dua model", ADR-0007 "Perpanjangan"). Jadi
  tidak ada lagi [TANYA] yang menggantung di dalam M3a; yang tersisa murni pengukuran dua perangkat dan browser.
- Gerbang mutasi untuk fail-open `claim` **belum ada di tangan siapa pun.** Bentuk editnya diblokir permission
  layer sebagai hard-block, dan pesan blokirnya menyebut bahwa niat pengguna tidak bisa membukanya, jadi saya
  tidak punya angka "D MERAH karena claim menerima frame tanpa `lk`" — yang saya punya dua mutan pengganti (M1
  label jawaban, M2 bocor `state`). Kalau ada jalur yang sah untuk mengukur fail-open, itu pekerjaan terbuka;
  sampai saat itu klaim "D mengikat jalur claim" bersandar ke M1/M2, bukan ke fail-open.

## Antrean defect yang belum punya gerbang

Ditulis di sini supaya tidak menguap jadi log percakapan. Tidak satu pun boleh masuk changelog
M3a sebagai "diperbaiki" tanpa tes, dan angka yang bukan hasil ukur saya sendiri saya labeli
sumbernya.

1. **`scripts/**` tidak masuk project tsconfig mana pun.** `tsconfig.app.json` hanya mengambil
   `src/app|screens|shared`, `tsconfig.worker.json` hanya `src/worker|shared` plus dua `.d.ts`,
   dan `tsconfig.json` di root isinya cuma `references` ke dua berkas itu — dibaca langsung,
   16 Nov 2026. Jadi `scripts/attack.ts`, `smoke-ws.ts`, `lint-arch.ts`, dan `gerbang.spec.ts`
   tidak pernah di-typecheck oleh `npm run check`. **Keputusan pemilik (S2) atas pertanyaan ini ada,
   dan berbunyi: "Jangan pasang, tunda" (`@types/node`)** — kanalnya AskUserQuestion, jam
   2026-11-15T18:46:12Z = 2026-11-16 01:46 WIB, alamat lengkap di baris S2 tabel §KOREKSI; tanggal
   "16 Nov" di kalimat lama adalah tanggal WIB, bukan UTC. Kalimat yang pernah saya kutip dari prompt
   checker, "`@types/node` belum dijawab → jangan pasang" (S6), adalah bagian yang **checker tarik
   sendiri 17 Nov**: jawabannya nyata, cuma mendarat sebagai `tool_result` dan tidak kelihatan di
   daftar turn yang dia baca. Jadi tidak ada yang berubah di tree ini — tetap tidak dipasang, tetap
   tanpa dependensi baru — tapi sekarang atas keputusan yang tercatat, bukan atas pertanyaan yang
   menggantung. Menunda juga bukan menolak permanen: yang bisa dikerjakan tanpa memasang apa pun ada
   di paragraf berikutnya.
   Jumlah error-nya tergantung siapa yang mengetik flag — itu sendiri
   bukti tidak ada project file yang menaungi `scripts/`: `tsserver` melaporkan 34 error di
   `attack.ts` (angka pelapor, TIDAK saya reproduksi), sedangkan

   ```
   npx tsc --noEmit --strict --target ES2022 --module esnext --moduleResolution bundler \
     --skipLibCheck scripts/attack.ts scripts/smoke-ws.ts
   ```

   memberi **8** — 7 di `attack.ts`, 1 di `smoke-ws.ts`, semuanya TS2307/TS2580/TS7006 karena
   deklarasi Node tidak ada. Bagian yang masih bisa dikerjakan tanpa dependensi baru: menaruh
   `scripts` di project tsconfig sendiri dengan `types: []`, lalu membereskan error yang tersisa
   dan melaporkan angkanya.
2. **Tidak ada gerbang yang menjamin bundel JS disajikan sebagai JavaScript.** `cek:ikon:http`
   hanya mengawal ikon. Worker lama melayani `/assets/index-<hash>.js` yang tidak dikenalnya
   sebagai `200 text/html` lewat SPA fallback → layar putih dengan satu-satunya gejala di konsol
   (module-MIME error); ini sudah menabrak saya sekali, lihat jebakan snapshot `dist/` di bagian
   M2. Bentuk perbaikan yang sah = assert `content-type` untuk `assets/index-*.js`, bukan status
   200 — pelajaran TEMUAN 4 berlaku lagi di sini.
3. **Klik pertama ±600 ms sesudah Stop/idle/Start.** Diukur pada DUA build: 613,0 ms (build M2)
   dan 642,9 ms (build pra-M2), jadi ia sudah ada sebelum servo dan bukan regresi M2. Kedua angka
   itu hasil ukur pelapor, BUKAN saya — saya belum mereproduksinya, dan tidak ada satu pun tes
   yang menjaganya.
4. **`rowsWritten` di panel diagnostik** pernah dilaporkan menampilkan "2 baris ditulis" untuk
   satu anggota. Ini masih DUGAAN dan belum diukur ulang oleh siapa pun, jadi tidak saya sentuh
   dan tidak saya tulis sebagai bug.

## Warna layar: satu tempat, kontras dihitung


`src/global.css` adalah satu-satunya tempat warna dasar dan komponen (`#0b0b0f` / `#eee`, dan
`theme-color` di `index.html` sekarang benar-benar dipakai). Layar memakai kelas, bukan
`style={{...}}` yang ditempel per layar — dulu tidak ada yang menyetel latar sama sekali, jadi
seluruh aplikasi dirender di atas putih bawaan browser dan tautan `#9cf` cuma 1,69:1.

Angkanya tidak dinilai dengan mata: `node scripts/cr.mjs` menghitung luminansi relatif WCAG untuk
setiap pasangan yang dikirim. Baris yang dipakai di layar, plus satu baris historis di atas putih
bawaan browser, dipetik apa adanya dari outputnya:

```
#eee di #0b0b0f = 16.93:1  [AA teks]  teks layar di atas latar global
#9a9ab0 di #16161c = 6.54:1  [AA teks]  label tombol disabled (vs bg disabled)
#808088 di #0b0b0f = 5.02:1  [AA teks]  border komponen vs latar halaman
  #9cf di #ffffff = 1.69:1  tautan lama
  #808088: tergambar #696970/#6c6c74 -> vsLayar 3.61 vsTombol 3.29 vsField 3.51 vsPanel 3.53 · MIN 3.29 LOLOS
  #6b6b78: tergambar #585863/#5b5b67 -> vsLayar 2.80 vsTombol 2.56 vsField 2.76 vsPanel 2.74 · MIN 2.56 kurang
```

Teks butuh 4,5:1 dan yang terukur 6,54–16,93:1. Border non-teks butuh 3:1 (SC 1.4.11, WCAG 2.2,
W3C Recommendation 12 Dec 2024) dan yang dipetik adalah **MIN 3,29**, bukan `vsLayar` 3,61 yang
paling memuji; empat permukaan tempat border itu tergambar memberi 3,29–3,61:1. Border `1px` di
layar ini tergambar dengan coverage 0,8, jadi pikselnya = 0,8×warna + 0,2×latar — itu sebabnya
calon `#6b6b78` gugur di MIN 2,56 dan yang dipakai `#808088`. Kalau menambah warna, tambahkan
barisnya ke script itu dulu, baru ke dokumen — dan itu bukan imbauan lagi: `penjaga kutipan`
(`cekKutipanREADME` di `scripts/cr.mjs`) memindai SEMUA blok berpayung di README, mengambil baris
yang berbentuk seperti outputnya (`#xxx di #yyy = …` dan `#xxx: tergambar …`), lalu membuat
tes gagal kalau salah satunya tidak ada verbatim di output itu sendiri — jadi blok palsu di
halaman lain ikut tertangkap, bukan hanya blok yang ditunjuk lewat nama. Di jalur yang ditegakkan
itu `barisOutput(0.8)` dipanggil dengan angka tertulis, supaya `COV=…` di environment tidak bisa
membungkam penjaga; di CLI, `COV=1` tetap mencetak DILEWATI karena di situ memang operator yang
mengubah parameternya. Border tombol `:disabled` (`#55555f`) sengaja di bawah 3:1 karena 1.4.11
mengecualikan komponen non-aktif.

## Ikon & shell PWA

Sumber: `public/ikon/Paranoid.jpg` — grayscale JPEG 480×480, `sha256=ca56e5ff…374491a`, 14120 B,
disimpan apa adanya (tidak di-encode ulang). Enam PNG keluarga `paranoid-*` ikut di-commit, bukan
dihasilkan saat
build: `scripts/buat-ikon.ps1` merender semuanya dengan System.Drawing (mesin ini tidak punya
`magick`/`ffmpeg`/`cwebp`, dan `convert` di PATH adalah utilitas disk FAT→NTFS Windows, jadi
jangan pernah memanggilnya). Mark putih di atas hitam pekat, jadi komposisi yang jujur ke latar
`#0b0b0f` adalah SCREEN, bukan tempel.

Yang bisa salah dan sudah pernah salah: `Marshal.Copy(dd.Scan0, db, …)` itu MEMBACA ke array
managed; hasil komposisi harus disalin balik (`Marshal.Copy(db, 0, dd.Scan0, …)`) sebelum
`UnlockBits`, dan kalau lupa, GDI+ tidak memberi error — enam ikon pertama yang "berhasil"
ternyata kanvas rata tanpa mark. Sekarang script membuka lagi berkas yang baru ditulis dan
gagal kalau tidak ada satu pun piksel >48 (`pxTerang=` di setiap baris log), dan
`scripts/cek-ikon.ps1` mencetak min/max tiap kanal sebagai bukti.

Maskable (`paranoid-maskable-512.png`) menahan mark di 60% tinggi kanvas — zona aman versi web.dev
adalah lingkaran berjari-jari 40% lebar dan "outer 10% edge might be cropped" — terukur mark
229×307 di tengah (setengah diagonal 191 px < 205 px). `paranoid-180.png` untuk iOS dan semuanya
ber-alpha penuh (min=max=255), jadi tidak ada kanal transparan yang bisa diinterpretasi lain.
Ukuran/tipe di `public/manifest.webmanifest` diambil dari `file` pada berkasnya, bukan diketik.

BELUM di diff ini: service worker dan offline (M7), mark logo di dalam layar (putuskan bersama
tema M7), dan `paranoid-1024.png` yang baru disimpan untuk cadangan M8 — tidak dirujuk manifest.
Tab dengan favicon dan "Add to Home Screen" di HP asli belum terukur; yang terukur adalah
Chromium sendiri meminta `/ikon/paranoid-32.png` dan `/ikon/paranoid-192.png` (ikon itu hanya ada
di manifest), dan `npm run check` hijau dengan 0 error console.
**16 Nov:** kalimat di atas mengacu ke tree sebelum permukaan web pindah mark — lihat bagian
berikutnya; `favicon-16.png`/`favicon-32.png` yang sekarang dirujuk `index.html:9-10`.

## Web pakai mark baru, aplikasi tetap pakai mark lama

Perintah pemilik, sampai ke saya sebagai kutipan di dalam prompt checker (S3, tabel §KOREKSI):
**"logo WEB pakai mark baru ini; logo APLIKASI tetap pakai yang lama."** Dua keluarga berkas di
satu folder, dipisahkan oleh namanya:

| permukaan | berkas | sumber | dibangun oleh |
|---|---|---|---|
| WEB (tab, favicon) | `public/ikon/favicon-16.png`, `favicon-32.png` | `aset/mark-web.png` | `scripts/buat-ikon-web.ps1` |
| APLIKASI (manifest, iOS, M8) | `public/ikon/paranoid-*.png` | `public/ikon/Paranoid.jpg` | `scripts/buat-ikon.ps1` — TIDAK dijalankan ulang |

Syarat pemilik (S3): sha256 enam ikon lama tidak boleh berubah satu pun. Ini `sha256sum` sebelum dan
sesudah build, dan diff-nya hanya MENAMBAH dua baris (baris `0a1,2` = tidak ada satu pun hash lama
yang bergeser):

```
$ sha256sum public/ikon/*.png public/ikon/*.jpg > sebelum.txt   # lalu scripts/buat-ikon-web.ps1
$ sha256sum public/ikon/*.png public/ikon/*.jpg > sesudah.txt
$ diff sebelum.txt sesudah.txt
0a1,2
> 34f7abf9836cda25595a8010a292787540e7c9c84cdca4ad2cf2f56c48911d53 *public/ikon/favicon-16.png
> 071fcaab4de5b10f50257b037e22278ae0b0265ee66c178cc16a04dde773ff19 *public/ikon/favicon-32.png
```

### Sumber baru tinggal di `aset/`, bukan di `public/`

`aset/mark-web.png` = 411.433 B, `sha256=319fe7c884b9a2c59cbc69194ed4b45e3a453a2b53351f7acac76fcec131b534`.
Disalin dari berkas temp Qoder (yang bisa dibersihkan kapan saja) dan di-hash **dua kali**: sekali
pada berkas sumber, sekali pada salinan di repo — angka yang sama, jadi salinannya utuh. Vite
menyalin `public/` apa adanya ke `dist/`, jadi sumber 411 KB di `public/` akan ikut ke setiap
unduhan; `aset/` tidak:

```
$ du -sb public dist aset
296357  public
544977  dist
411433  aset
$ find dist -type f | grep -c aset
0
```

Dua favicon baru jumlahnya 422 + 871 = 1.293 B; sumber 411.433 B tidak masuk ke `dist` sama sekali
(`grep -c aset` = 0), yang adalah seluruh alasan `aset/` dipakai.

### Yang diukur dari sumbernya, bukan dari laporan

Dua alat, dua lintasan piksel berbeda, atas berkas yang sama. `scripts/ukur-ikon.ps1` adalah skrip
pengukuran yang ditulis checker dan kusimpan apa adanya (satu lintasan LockBits, sepuluh ambang,
tanpa `-ReferencedAssemblies` System.Drawing tidak melihat `System.Drawing.Imaging`);
`buat-ikon-web.ps1 -Ukur` milikku dan tidak memanggil yang itu.

```
$ powershell -File scripts/ukur-ikon.ps1 -Path aset/mark-web.png
format=Format32bppArgb size=3264x3264
alpha[min,max,piksel<255]=0,255,9344357
luminansi[min,max,mean]=0,254,31
hist16=9334501,1962,1433,1342,1307,1060,1091,961,1266,1304,1494,1575,1922,2127,2712,1297639
thr>0: n=1324246 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>8: n=1320536 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>16: n=1319023 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>32: n=1317133 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>48: n=1315720 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>64: n=1314355 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>96: n=1312008 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>128: n=1309811 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>192: n=1304323 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
thr>240: n=1297385 x 25..3061 y 23..3240 -> mark 3037x3218 tengah x=1543 y=1631.5 fraksi=0.9305
pixel(0,0) = #000000 a=0
pixel(3263,0) = #000000 a=0
pixel(0,3263) = #000000 a=0
pixel(3263,3263) = #000000 a=0
pixel(1632,1632) = #FFFFFF a=255
pixel(1632,195) = #FFFFFF a=255
pixel(1632,3068) = #F3F3F3 a=221
bytes=411433

$ powershell -File scripts/buat-ikon-web.ps1 -Src aset/mark-web.png -OutDir aset -Ukur
sumber aset/mark-web.png 3264x3264 format=Format32bppArgb
rgb(> 48)   x 25..3061 y 23..3240 -> 3037x3218 n=1315700 tengah x=1543 y=1631.5 margin kiri=25 kanan=202 atas=23 bawah=23
tinta(> 48) x 534..2734 y 84..3102 -> 2201x3019 n=1308741 tengah x=1634 y=1593 margin kiri=534 kanan=529 atas=84 bawah=161
alpha>0 n=1937133 alpha[min,max]=0,255  alpha>0 & maxKanal<128 (bagian gelap/bayangan) = 627274  maxDeltaKanal = 0
ekor rgb>tinta: kanan x 2735..3061 = 9 piksel (alpha[max]=27) | bawah y 3103..3240 = 11 piksel (alpha[max]=76) | inti 1315662 piksel, maxRGB*alpha/255 rata-rata = 251.81
```

`thr>0 … thr>240` di atas adalah box berbasis **max kanal RGB**, dan box itu tidak bergerak sama
sekali di sepuluh ambang — bahkan `pixel(1632,3068) = #F3F3F3 a=221` menunjukkan RGB-nya sendiri
menyusut di tepi, bukan hanya alpha. Baris `tinta(> 48)` adalah box berbasis **max RGB × alpha**
(seberapa banyak cahaya yang benar-benar sampai ke kanvas), dan dia berhenti 327 px lebih awal di
kanan (2734 vs 3061) serta 138 px lebih awal di bawah (3102 vs 3240). Baris `ekor rgb>tinta`
menghitung siapa yang membuat selisih itu: **9 piksel** di pita kanan (alpha tertingginya 27) dan
**11 piksel** di pita bawah (alpha tertingginya 76), di antara 1.315.662 piksel inti. Jadi box rgb
diseret 327 px oleh 20 piksel nyaris hampa, sementara inti mark rata-rata memancarkan 251,81 dari
255 level. Angka inilah yang membuat `buat-ikon-web.ps1` menengahkan dengan box premultiplied.

Catatan supaya tidak tertukar saat mengukur ulang: `-Ukur` mengukur salinan `Format32bppArgb`
buatan GDI+, `ukur-ikon.ps1` mengukur hasil decode langsung. Hitungannya beda sampai puluhan
piksel (n=1.315.700 vs 1.315.720 pada ambang 48) — itu resampling 1:1, bukan dua sumber berbeda.
Dan `627.274` (baris `alpha>0 & maxKanal<128`) dengan `627.794` (turunan di bawah ini) adalah dua
predikat yang berbeda: yang pertama menyaring kanal gelap, yang kedua menyaring alpha.

Angka-angka itu yang menentukan bentuk jalurnya, dan tiga di antaranya membuat `buat-ikon.ps1`
tidak bisa dipakai apa adanya:

1. **Sumbernya ber-alpha, bukan JPEG pekat.** `ukur-ikon.ps1` mencetak `piksel<255 = 9.344.357`
   dari 3264×3264 = 10.653.696 (87,71%) — tapi 8.716.563 di antaranya alpha=0 (10.653.696 −
   `alpha>0` 1.937.133), jadi yang benar-benar menarik adalah 9.344.357 − 8.716.563 = **627.794
   piksel semi-transparan**. `buat-ikon.ps1:101` memaksa `db[j+3] = 255` sesudah komposit. Untuk
   ikon aplikasi itu memang yang diinginkan; untuk web itu menghapus satu-satunya pilihan latar.
2. **Tintanya tidak cuma putih.** `maxDeltaKanal = 0` → setiap piksel ber-alpha netral (R=G=B),
   tapi 627.274 di antaranya `maxRGB < 128`: bayangan lunak yang dibakar di sekeliling glyph.
   Komposisi SCREEN (`buat-ikon.ps1:99`) **membuang** piksel gelap — hitam di atas latar apa pun
   tetap latar itu — jadi bayangannya hilang tanpa error. Yang jujur di sini SRC-OVER
   (`rgb*alpha + latar*(1-alpha)`), dan itu yang dipakai `buat-ikon-web.ps1`.
3. **Dua bounding box, dua pusat.** Pusat box RGB ada di x=1543, y=1631,5; pusat box premultiplied
   (baris `tinta`) di x=1634, y=1593 — selisih 91 px horizontal dan 38,5 px vertikal, disebabkan 20
   piksel ekor ber-alpha ≤76 itu. Margin box RGB memang asimetris (kiri 25 vs kanan 202 — bukan
   salah crop, memang begitu sumbernya), sedangkan box premultiplied hampir simetris (534 vs 529).
   **Yang dipakai untuk menengahkan dan men-skala adalah box premultiplied.** Kalau box RGB yang
   dipakai, `ox = ukuran/2 − 1543·scale` lebih besar daripada `ukuran/2 − 1634·scale`, jadi tinta
   jatuh 91·scale = **0,42 px ke kanan di kanvas 16 px** dan **0,83 px di 32 px** (skala 0,00456 /
   0,00912 yang tercetak di laporan build), dan 38,5·scale = 0,18 / 0,35 px ke atas. Simpangan itu
   masih sub-piksel, tapi arahnya salah dan tidak bisa diperbaiki lewat mata — makanya tidak dipakai.

### Kenapa favicon-nya kotak pekat, bukan PNG transparan — dihitung

Mark-nya tinta putih. Kalau disimpan transparan, yang melihatnya adalah warna tab browser, dan itu
bukan warna yang kita pilih:

```
$ node --input-type=module -e "
import { cr } from './scripts/cr.mjs';
const p = [['#ffffff','#dee1e6','tinta mark putih di atas tab Chromium TERANG'],
           ['#ffffff','#ffffff','tinta mark putih di atas toolbar/new-tab putih'],
           ['#ffffff','#0b0b0f','tinta mark di atas kotak favicon yang dibangun'],
           ['#0b0b0f','#dee1e6','kotak favicon vs tab Chromium terang'],
           ['#0b0b0f','#202124','kotak favicon vs tab Chromium gelap']];
for (const [a,b,k] of p) console.log(k.padEnd(46), a, 'vs', b, '= CR', cr(a,b).toFixed(2)+':1');"

tinta mark putih di atas tab Chromium TERANG   #ffffff vs #dee1e6 = CR 1.31:1
tinta mark putih di atas toolbar/new-tab putih #ffffff vs #ffffff = CR 1.00:1
tinta mark di atas kotak favicon yang dibangun #ffffff vs #0b0b0f = CR 19.64:1
kotak favicon vs tab Chromium terang           #0b0b0f vs #dee1e6 = CR 14.98:1
kotak favicon vs tab Chromium gelap            #0b0b0f vs #202124 = CR 1.22:1
```

Bentuk barisnya sengaja `vs`, bukan `di ... =` seperti output `scripts/cr.mjs`: penjaga kutipan di
`cekKutipanREADME` membandingkan baris ber-bentuk itu dengan daftar `PAIRS` script tersebut, dan
pasangan warna tab browser memang bukan bagian daftar itu. Rumusnya tetap fungsi yang sama —
`cr()` yang diimpor dari `scripts/cr.mjs`, bukan salinan rumus.

1.31:1 dan 1.00:1 artinya glyph-nya tidak ada di tab terang. Karena itu web dibangun di atas
`#0b0b0f` — sama seperti ikon aplikasi dan `theme-color` — dan konsekuensinya ditulis apa adanya:
di tab gelap tepi kotaknya menyatu (1.22:1), tapi glyph di dalamnya tetap 19.64:1 terhadap kotaknya
sendiri. Yang hilang cuma garis tepi, bukan logonya.

### `InkFrac` dipilih dari angka, bukan dari rasa

Sweep empat fraksi tinggi-tinta (0 = kanvas penuh di script lama) ke direktori kerja, ukuran yang
sama dilaporkan untuk 16 dan 32 px:

| `InkFrac` | digambar (px) | margin @16 | pxTerang @16 | sendiri @16 | pxTerang @32 | sendiri @32 |
|---|---|---|---|---|---|---|
| 0.70 | 12.11 / 24.22 | 1.94 | 32 | 0 | 101 | 0 |
| 0.78 | 13.49 / 26.99 | 1.25 | 33 | 0 | 132 | 0 |
| **0.86** | **14.88 / 29.75** | **0.55** | **44** | **0** | **149** | **0** |
| 0.92 | 15.91 / 31.83 | 0.03 | 51 | 0 | 161 | 0 |

0.92 paling banyak piksel terangnya, dan ditolak justru karena angka keduanya: `offset=(0.03,0.23)`
pada 16 px berarti kanvas sumber menempel tepi ikon, dan dua runcing atas-bawah glyph — ciri
utamanya — jadi baris terakhir piksel. 0.86 dipilih. Gate pemotongan di `buat-ikon-web.ps1` sudah
diserang, bukan cuma ditulis: `-InkFrac 0.95` keluar dengan

```
kanvas sumber terpotong di …\favicon-32.png: draw=32.87 offset=(-0.45,-0.04) untuk ikon 32 px pada inkFrac=0.950 (maks 0.925)
```

jadi fraksi yang memotong runcing glyph tidak bisa masuk diam-diam kalau seseorang mengganti angkanya.

### Legibilitas 16 dan 32 px diukur di BROWSER yang menyajikan berkasnya

Angka di atas adalah output `browser_evaluate` pada `http://127.0.0.1:8787` (`wrangler dev
--assets=dist`): tiap berkas dimuat sebagai `<img>`, digambar ke canvas, lalu `getImageData`.
"diturunkan browser ke 16" = apa yang Chromium lakukan sendiri ketika tab 1× hanya punya berkas
32 px — jadi baris itu bukan resample versiku, tapi resample browser.

| berkas / perlakuan | pxTerang | sendiri | min RGBA | max RGBA |
|---|---|---|---|---|
| `favicon-32.png` di 32 px | 149 | 0 | 7,7,9,255 | 255,255,255,255 |
| `favicon-32.png` **diturunkan browser ke 16** | 43 | 0 | 10,10,14,255 | 255,255,255,255 |
| `favicon-16.png` native 16 | 44 | 0 | 10,10,14,255 | 255,255,255,255 |
| `paranoid-32.png` (LAMA) di 32 px | 132 | **4** | 11,11,15,255 | 255,255,255,255 |
| `paranoid-32.png` (LAMA) diturunkan ke 16 | 38 | **2** | 11,11,15,255 | 254,254,254,255 |

`sendiri` = piksel terang yang keempat tetangganya gelap: penanda stroke yang putus jadi bintik.
Mark baru nol di kedua ukuran; mark lama punya 4 di 32 px dan 2 di 16 px. Mark baru juga lebih
banyak massanya (149 vs 132 di 32; 44 vs 38 di 16) dan menyentuh putih penuh (255) sesudah
diturunkan, sedangkan yang lama mentok di 254. `min` 7 pada 32 px adalah bayangan yang SRC-OVER
pertahankan (latar `#0b0b0f` = 11,11,15, jadi 7 berarti lebih gelap dari latarnya).

Cross-check alat kedua, `scripts/ukur-ikon.ps1` di atas berkas yang sama di disk:

```
favicon-16.png  thr>48: n=44  x 4..12 y 2..13 -> mark 9x12 tengah x=8 y=7.5   alpha[min,max]=255,255  bytes=422
favicon-32.png  thr>48: n=149 x 6..24 y 4..27 -> mark 19x24 tengah x=15 y=15.5 alpha[min,max]=255,255  bytes=871
```

Dua lintasan piksel yang tidak saling memanggil memberi 44 dan 149 — angka yang sama dengan yang
dicetak build script dan browser.

Artefaknya: `bukti/b8-favicon-16-32.png` (848×880, Chromium lewat Playwright, `scale: css`) —
baris 1 tab mock `#dee1e6`, baris 2 `#202124`, baris 3–4 tiap berkas diperbesar 10× tanpa smoothing
(`imageSmoothingEnabled = false`), jadi yang terlihat adalah piksel asli berkas yang disajikan.
**Batasannya ditulis, tidak disembunyikan:** Playwright tidak bisa merekam strip tab Chromium —
screenshot browser hanya sampai viewport. Yang dibuktikan b8 adalah berkas yang benar-benar
dijajikan, digambar browser, di ukuran yang benar-benar dipakai; bukan tangkayan layar tab.
Tab asli di HP (dan `apple-touch-icon` di iOS) masih belum terukur, sama seperti sebelumnya.

### Gerbang baru: dua permukaan tidak boleh bertukar keluarga

Keputusan pemilik itu (S3) sekarang diperiksa, bukan dipercaya (`scripts/gerbang-ikon.mjs` §2b, jalan di
`npm run cek:ikon` DAN di `npm run check` lewat `scripts/gerbang.spec.ts`): tiap `<link rel="icon">`
harus menunjuk `favicon-*`, tiap ikon manifest dan `apple-touch-icon` harus menunjuk `paranoid-*`.
Diserang dengan mengganti favicon kembali ke mark lama:

```
$ node scripts/gerbang-ikon.mjs        # index.html sengaja ditunjuk ke /ikon/paranoid-32.png
gerbang ikon: 1 KLAIM GAGAL
  index.html rel="icon": /ikon/paranoid-32.png adalah permukaan WEB — harus favicon-* (mark baru), bukan keluarga paranoid-*
```

`index.html` dikembalikan sesudah serangan, dan `npm run cek:ikon` pada tree ini menutup dengan
`gerbang ikon: 8 berkas, 6 rujukan, tidak ada kembar, semua sha+IHDR cocok`.

### Tiga hal yang bukan keputusanku — satu terjawab (S4), dua masih [TANYA]

1. **`apple-touch-icon` = permukaan APLIKASI** — pemilik menjawabnya (S4) 2026-11-16 23:47 WIB
   (via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:47:48.682Z, baris S4 tabel §KOREKSI): tetap
   `paranoid-180.png` (mark lama berbingkai). Jawaban itu sampai ke sesi ini **dirolay lewat prompt
   checker**, bukan sebagai turn saya sendiri — itu sebabnya penanda sumbernya menunjuk sesi lain.
   Alamat di baris ini sempat salah (`16:50:13.874Z`, jam `node -e` checker 2 m 25 d sesudahnya); nilai
   lama itu dibiarkan tertulis di baris S4, bukan dihapus.
   Konsekuensinya di kode: NOL. `scripts/gerbang-ikon.mjs` tidak saya ubah; klasifikasi yang sudah
   ada di dalamnya (`web` HANYA untuk `index.html rel="icon"`) ternyata persis cocok dengan jawaban
   ini, jadi yang berubah cuma catatan di README/rencana.
2. **Mark di dalam layar** (README bagian "Ikon & shell PWA") — masih `[TANYA]`. Kotak M3a memang
   terbuka (S4), tapi "boleh menyentuh `src/`" tidak sama dengan "putuskan logonya", dan tema itu
   tercatat bersama M7.
3. **`og:image` belum ada sama sekali** — masih `[TANYA]`. Menambahkannya berarti (a) satu gambar
   1200×630 yang layout-nya belum diputuskan dan (b) URL absolut ke produksi — dan itu tidak bisa
   kubuktikan dari sini tanpa deploy, yang tidak diizinkan (S5).


## KOREKSI 2026-11-16/17 — kalimat yang menyebut pemilik ditulis tanpa alamat

Sesi checker menemukan (S6) bahwa commit `1a30bba` (2026-11-16 01:50 WIB = 2026-11-15T18:50Z)
menuliskan atribusi tanpa satu pun alamat yang bisa ditunjuk, lalu menyimpulkan tidak ada yang pernah
menjawabnya. Kesimpulan itu sebagian salah, dan bagian yang benar adalah cacat yang nyata: **jawabannya
ada, kanalnya yang tidak ditulis.** Tiga jawaban itu datang lewat alat `AskUserQuestion`, yang hasilnya
masuk sebagai `tool_result` di sesi saya — bukan sebagai turn chat — sehingga daftar turn yang dibaca
checker memang tidak bisa melihatnya. Yang saya perbaiki di sini bukan isinya, tapi alamatnya.

### 2026-11-17 — checker menarik dua dari tiga temuannya, dengan angka dan alamat

Retraksi ini datang dari sesi checker sendiri setelah dia mengukur kanal `tool_result`, bukan dari
saya. Yang bertahan cuma temuan ketiga. Rinciannya, supaya dokumen ini tidak lagi menyimpan kalimat
yang sudah ditarik:

1. **"atribusi tanpa sumber = tidak ada yang menjawab"** — **ditarik.** Daftar turn yang dibaca
   checker memang kosong di jam itu, dan itu bukan bukti: jawaban `AskUserQuestion` masuk sebagai
   `tool_result`. Terukur hari ini sebagai field `timestamp` asli di transkrip sesi saya
   (`d27c1add`): `2026-11-15T18:44:35.788Z` dan `18:44:44.543Z` = rekaman `type: assistant` (panggilan
   alatnya), `2026-11-15T18:46:12.942Z` (uuid `63c06fb6-462f-40b4-981d-0e4cfb7e6fec`) = rekaman
   `type: user` dengan `content[0].type = "tool_result"` — isi jawaban pemilik S2. Commit `1a30bba`
   berdate `2026-11-15T18:50:41Z` (`git show -s --format=%aI 1a30bba` =
   `2026-11-16T01:50:41+07:00`), yaitu **268058 ms ≈ 4 m 28 d SETELAH** jawaban itu
   (`node -e` atas `Date.parse` kedua jam). Jadi yang hilang adalah alamat kanalnya, bukan jawabannya.
2. **"satu kotak `[ ]` → `[x]` tanpa ada yang mencentang"** — **ditarik.** Angkanya di blok
   "Sebelum/sesudah" di bawah: empat commit lama (`34e234c`, `eaf5e63`, `1a30bba`, `452488c`) sama-sama
   5 `[x]` / 1 `[ ]`, dan angka `6` pertama muncul di commit tes RED `178e1e9`, bukan di `1a30bba`.
3. **Yang TIDAK ditarik** — dan itu memang cacat `1a30bba`: klaim pemilik yang ditulis tanpa alamat
   apa pun. Penjaga bentuk di `scripts/gerbang.spec.ts` tetap berdiri untuk itu, dan tetap tidak
   saya longgarkan.

### Urutan "tahan" → "boleh": S2 menahan, S4 membuka — keduanya sah, tidak ada yang dibersihkan

- S2, via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:46:12.942Z: pemilik menahan kode, lewat
  label opsi yang saya tulis sendiri — *"Tahan dulu, tetap docs-only"*.
- S4, via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:47:48.682Z (= 23:47 WIB): pemilik membuka
  kotak kode M3a dengan kata kerja "lanjutkan ke tahap selanjutnya", dan itu urutan yang saya kerjakan:
  B1 tes GAGAL `178e1e9` → B2 kode `b9fc0f3` → B3 dokumen `33c2342`.

Yang kedua menggantikan yang pertama pada 16 Nov, dan itu bukan kontradiksi yang perlu saya ralat:
keduanya jawaban pemilik pada jamnya masing-masing. Catatan S2 tetap ada di tabel, tidak saya hapus dan
tidak saya tulis ulang jadi "sejak awal memang boleh". Bagian M3a di atas tulisan ini sudah menggambarkan
keadaan sesudah S4, bukan sesudah S2.

Cara memverifikasi sebuah alamat (dan ini yang berubah sejak catatan lama di bawah): transkrip
`.jsonl` bisa dibaca **hanya-baca** lewat Grep pola `"timestamp":"…"` — parser `node` atas berkas itu
diblokir, tapi grep-nya tidak. Jadi alamat di tabel §Tabel alamat di bawah ini bukan lagi janji kosong:
tiap jam saya cek sebagai field `timestamp` sungguhan, bukan sebagai teks yang dikutip di dalam isi
pesan. Bedanya penting, dan ini hasil ukur hari ini: `2026-11-16T16:50:13.874Z` dan
`2026-11-16T17:32:47Z` **nol** kecocokan sebagai field `"timestamp":"…"` di kedua transkrip — tapi
keduanya BUKAN teks kosong. Yang pertama adalah output `node -e` yang checker cetak sendiri sebelum
bertanya (rekaman yang memuatnya ber-field `16:50:13.934Z` di transkrip `2d6f4ca7`, 60 ms sesudah
cetakan); yang kedua adalah output `node -e` di SESI SAYA saat membaca prompt (cetakannya
`17:32:47.248Z`, rekaman penampungnya ber-field `17:32:47.356Z` di transkrip `d27c1add`). Jadi keduanya
adalah **jam mesin yang dikutip di dalam isi pesan**, bukan jam sebuah turn — itu sebabnya saya cabut
sebagai alamat; lihat baris S4 dan S6 di tabel.

Yang tidak berubah karena koreksi atribusi ini, diukur di tree:

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

Lima `[x]` + satu `[ ]` (kotak kode M3a) di keempat commit sebelum M3a: tidak ada kotak yang berpindah
status di `1a30bba`, jadi klaim "satu kotak `[ ]` → `[x]` tanpa ada yang mencentang" salah — checker
menariknya, dan angka di atas yang menariknya. **Bagian yang salah di README saya sendiri juga dicabut
di sini:** kalimat lama menyebut "`6` di worktree, belum ada di commit mana pun". Itu sudah tidak benar
sejak `178e1e9` (2026-11-16T18:18:19Z, `git show -s --format=%aI`) — kotak kode M3a tercentang pertama
kali di commit tes RED, karena jawaban pemilik S4 memang membuka kotak itu dan saya mencentangnya saat
menulis tes, bukan saat mengoreksi dokumen. Sisa perhitungannya tidak berubah: 6 centang + 1 kotak
kosong, dan yang kosong itu kotak dua-perangkat §7.

Koreksi ini ditulis sebagai commit ke depan. `1a30bba` tidak di-amend dan tidak di-rebase: dua sesi
bekerja di satu working tree, dan menulis ulang history yang sudah dilihat sesi lain justru
menghancurkan jejak yang lagi diperiksa.

Aturan dari checker (S6): setiap baris yang memuat kata pemilik di sebelah salah satu dari
keputusan/perintah/instruksi/syarat/jawaban/konfirmasi — di `README.md`, `docs/plans/**`, atau
`docs/adr/**` — harus membawa salah satu: `[TANYA]`, alamat
`via <sessionId>@<UTC>`, atau kunci `S<n>` yang baris tabelnya di berkas yang sama membawa alamat. Penegaknya assertion
`setiap klaim keputusan pemilik di dokumen membawa alamat sumber yang bisa ditunjuk` (S6) di
`scripts/gerbang.spec.ts`, jalan di `npm run check` tanpa perlu ada yang mengingat perintahnya.
Batasnya tetap: penjaga ini memeriksa BENTUK alamat, bukan ISI jawaban. Tapi catatan lama di titik ini
("transcript diblokir untuk dibaca") sudah tidak benar dan saya cabut: berkas `~/.qoder/projects/*.jsonl`
ternyata bisa dibaca **hanya-baca** lewat Grep dengan pola `"timestamp":"…"` — yang diblokir hanyalah
mem-parse-nya dengan `node`. Jadi verifikasi sebuah alamat hari ini adalah grep atas field `timestamp`
(asli, bukan kutipan di dalam isi pesan) plus mata manusia membuka sesinya di App — bukan assertion di
dalam tes. Kolom "Alamat" di tabel berikut sudah lewat grep itu, dan dua nilai yang tidak lolos
(`16:50:13.874Z` dan `17:32:47Z`) saya coreng di barisnya masing-masing, bukan saya hapus diam-diam.

Penjaga ini diserang dua arah, dan keduanya keluar sebagai RED:

```
# 1) satu kalimat pemilik palsu saya tempel di ujung README (tanpa alamat apa pun)
$ cp README.md /tmp/readme.bak
$ printf '\n**Keputusan pemilik 2026-11-17: ADR-0006 memakai socket mentah, jadi tidak perlu ditanya ulang.**\n' >> README.md
$ npx vitest run scripts/gerbang.spec.ts
AssertionError: klaim pemilik tanpa [TANYA] / via <sessionId>@<UTC> / S<n> yang baris tabelnya beralamat: expected [ Array(1) ] to deeply equal []
+   "README.md:1086 |**Keputusan pemilik 2026-11-17: ADR-0006 memakai socket mentah, jadi tidak perlu ditanya ulang.**|",

# 2) kontrol positif: kata "pemilik" saya hapus dari README + docs/plans + docs/adr
$ perl -i -pe 's/pemilik/pengguna/gi' README.md docs/plans/*.md docs/adr/*.md
$ npx vitest run scripts/gerbang.spec.ts
AssertionError: README/docs tidak menyisakan satu pun klaim pemilik — penjaga ini hilang, bukan lulus: expected 0 to be greater than 0
```

Yang pertama menangkap kalimat karangan; yang kedua memastikan penjaganya tidak lulus cuma karena
kalimatnya dihapus. Setelah serangan berkasnya saya kembalikan dan diverifikasi hash:
`sha256sum README.md` = `8bb19903039a7d0a4effe5e7e58bfac481a3ad318116e4e0403661bf8f6c1285` sama sebelum
dan sesudah.

**Kecelakaan selama serangan ini, dicatat bukan disimpan:** backup kedua saya flatten ke satu folder
(`cp README.md docs/plans/*.md docs/adr/*.md /tmp/dokbak/`), dan `README.md` repo menabrak
`docs/adr/README.md` yang namanya sama — waktu dipulihkan, README repo ke-tulis ulang jadi ADR index
(`f920f0b9…`). `sha256sum -c` menangkapnya (`README.md: FAILED`), dan berkasnya kembali utuh dari backup
pertama (`/tmp/readme.bak`). Tidak ada perubahan yang hilang: tidak satu pun berkas `docs/adr/**`
berubah, `git diff --stat` sesudah pemulihan hanya menyebut `README.md`, rencana M3a, dan
`scripts/gerbang.spec.ts`. Lesson yang saya terapkan seterusnya: backup banyak berkas dipakai dengan
struktur direktori, bukan disatukan berdasarkan basename.

Tabel alamat. Kunci dipakai di dalam README ini saja — assertion resolve per berkas, jadi rencana M3a
menyalin baris yang dia butuh di §8.2 berkasnya sendiri.

| Kunci | Isi | Alamat | Kanal |
|---|---|---|---|
| S1 | empat jawaban §6 rencana M3a, termasuk *"Setuju, tapi jangan kode dulu"* | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T09:16:14.324Z | `AskUserQuestion` → `tool_result` di sesi saya |
| S2 | *"Tahan dulu, tetap docs-only"* · *"did unik di antara socket hidup"* · *"Jangan pasang, tunda"* (`@types/node`) | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:46:12.942Z = 2026-11-16 01:46 WIB | `AskUserQuestion` → `tool_result` (beberapa jawaban dalam SATU panggilan) |
| S3 | *"logo WEB pakai mark baru ini; logo APLIKASI tetap pakai yang lama."* + syarat sha256 enam ikon lama | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:51:40Z | turn chat saya — isinya prompt checker yang mengutip perintah pemilik; jamnya dilaporkan sesi checker (2d6f4ca7), saya tidak mengukur ulang |
| S4 | jawaban pemilik dua pertanyaan di sesi checker: **kotak kode M3a dibuka** ("lanjutkan ke tahap selanjutnya") + **`apple-touch-icon` = permukaan APLIKASI** (`paranoid-180.png` tetap, `gerbang-ikon.mjs` jangan disentuh) | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:47:48.682Z (uuid rekaman `4713e8f8-5888-4b7d-9bd6-b721428b834a`, `type: user` + `tool_result`, baris 2720) | pemilik menjawab di sesi 2d6f4ca7 23:47 WIB; isinya sampai ke saya **dirolay prompt checker**, bukan sebagai turn di sesi ini. **Alamat lama di baris ini salah dan checker mengakuinya sebagai salahnya sendiri:** `16:50:13.874Z` adalah output `node -e` yang dicetak checker 2 m 25 d SESUDAH jawaban itu, sebelum dia bertanya ke saya — tercatat sebagai isi pesan, nol kecocokan sebagai field `timestamp`; rekaman yang memuatnya ber-field `16:50:13.934Z` |
| S5 | aturan berdiri: `JANGAN deploy`, `JANGAN push`, tulis ke produksi butuh izin eksplisit, larangan skill `vercel-deploy`, larangan commit `tail*.log` | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:38:43Z | turn `CHECKER → EXECUTOR` yang memetik aturan pemilik; jamnya dilaporkan sesi checker, saya tidak mengukur ulang |
| S6 | tiga prompt checker: (a) temuan provenance atas `1a30bba` + tuntutan assertion penjaga, (b) arahan M3a B0–B4, (c) tambahan soal §6.2 | (a) via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:33:23.589Z · (b) via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:51:22.707Z · (c) via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:58:04.311Z | ketiganya jam kirim **di transkrip checker**, diukur sebagai field `timestamp` atas rekaman `type: assistant` (baris 2690-2692, 2732-2734, 2785-2786). (a) mendarat di sesi saya 10 detik kemudian (`16:33:33.483Z`, turn delegasi). **Alamat lama `…@2026-11-16T17:32:47Z` dicabut:** itu jam `node -e` di sesi saya sendiri saat membaca prompt (cetakan `17:32:47.248Z`) — string `17:32:47Z` nol kecocokan sebagai field `timestamp`, dan yang ada cuma field rekaman penampung cetakannya, `17:32:47.356Z` — begitu juga bentuk pendek `via 2d6f4ca7@…` yang checker pakai di promptnya, yang memang tidak bisa dibaca regex penjaga (`P_VIA` menuntut UUID penuh + detik) |
| S7 | jawaban pemilik atas tafsir §6.2 di sesi checker: **"Socket mentah"** lalu, setelah kedua jawaban lama saya tampilkan padanya, **"Tetap socket mentah"** | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:57:02.999Z (uuid `0967ee46-533c-448f-b4bf-1023bdf7566d`, baris 2773) · via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T20:36:32.241Z (uuid `efad1bdd-6a28-4a4f-a6ba-134242068698`, baris 2951) | sama seperti S4: pemilik menjawab di sesi checker, keduanya `type: user` + `tool_result` (AskUserQuestion). Yang saya terima dari sesi saya cuma rangkumannya lewat prompt (b) dan (c), jadi baris inilah alamat aslinya |

### §6.2 SELESAI (S7) — kursi dari socket mentah, dan ini bukan keputusan saya

Riwayatnya, supaya tidak dibaca sebagai kontradiksi. (1) 15 Nov 18:46Z pemilik memilih label opsi (S2)
*"did unik di antara socket hidup"*. (2) 16 Nov 16:51Z prompt checker menyatakan pertanyaan tafsir
§6.2 itu belum dijawab pemilik (S6b) — dan itu **salah framing**, sebab yang sama dengan dua tuduhan
yang dia tarik di atas: jawaban S2 mendarat sebagai `tool_result` dan tidak kelihatan di daftar turn.
(3) Setelah kedua jawaban lama ditampilkan ke dia, dia menjawab dua kali di sesi checker dan **mengganti
pilihannya sendiri**: "Socket mentah" (S7, 16:57Z) lalu "Tetap socket mentah" (S7, 20:36Z, sesudah
konskuensi 2-kursi dibacakan ulang ke dia). Urutan ini sah, bukan pertengkaran: yang dijawab 16 Nov itu
pertanyaan yang diformulasikan ulang, dan jawabannya membatalkan pilihan 15 Nov secara eksplisit.

Karena itu kode `b9fc0f3` benar apa adanya: `seatCount()` = `getWebSockets()` dengan
`readyState === OPEN`, **mentah, tanpa deduplikasi `did`** — tidak ada perubahan kode, tidak ada tes yang
pindah angka (`session.spec.ts:149` tetap menuntut `members: 13`). Pertanyaan yang tadi menggantung di
README bagian M3a dan di ADR-0006 tertutup oleh jawaban itu, bukan oleh ukur baru.

Konsekuensinya saya tulis apa adanya dan tidak dilunakkan jadi "aman": dengan socket mentah, satu HP yang
network-nya flap atau me-reload halaman sebelum socket lama terdeteksi tutup memegang **2 kursi**, jadi
ruangan 12 HP bisa menjawab `FULL` padahal ada 11 HP nyata di tengah latihan. Itu harga yang diterima
pemilik bersama jawabannya (S7), dan satu-satunya penahan yang tercatat adalah `webSocketClose`
menyiarkan `state` (`SessionDO.ts:325-337` di `a6ea775`) supaya angkanya bisa turun sendiri. Rantai
itu sekarang punya dua penahan yang diukur, bukan dua kalimat: siaran di `close` DAN fakta bahwa
error di sisi server menyusul ke `close` juga (bagian "TEMUAN 2 ronde kedua" di atas).

## Gerbang ikon: tidak ada kembar, tidak ada bukti status

`scripts/gerbang-ikon.mjs` dan penjaga kutipan di `scripts/cr.mjs` adalah fungsi yang diimpor
`scripts/gerbang.spec.ts`, jadi keduanya jalan di dalam `npm run test` — dan karena itu di
`npm run check` — tanpa perlu ada yang mengingat perintahnya. `npm run cek:ikon` dan
`npm run cek:kontras` tetap ada sebagai CLI (tabel sha/IHDR dan semua CR tercetak di sana), tapi
mereka bukan tempat penegakan lagi: sebelumnya mereka memang berdiri sendiri di `check`, dan itu
masih bisa "dijanjikan lalu dilupakan" kalau satu langkah dihapus dari rantai.

Yang dijaga, dan kenapa:

- **File kembar.** Bug `Marshal.Copy` di atas menghasilkan `paranoid-512.png` identik byte dengan
  `paranoid-maskable-512.png`, karena satu-satunya perbedaan di antara keduanya hidup tepat di
  komposit yang terbuang. Penjaga per-file (`terang == 0`) TIDAK bisa melihat itu — dua file kembar
  sama-sama punya piksel terang. Yang melihatnya hanya perbandingan sha256 antar-berkas, jadi itu
  yang di-`throw` di sini. Diserang dengan `cp paranoid-512.png paranoid-maskable-512.png`:
  `IKON KEMBAR: … sha256 sama (555728d44a2608df…) — maskable tidak boleh identik dengan 512 biasa`,
  exit 1, dan `npm run check` ikut jatuh.
- **Ukuran yang ditulis = ukuran di file.** `sizes` di manifest dan `sizes` di `index.html` dibaca
  dari header IHDR tiap PNG, bukan dipercaya; lima rujukan diperiksa, dan ikon tanpa `purpose`
  maskable membuat manifest gagal.
- **Status 200 BUKAN bukti.** `wrangler.jsonc` memakai `not_found_handling: "single-page-application"`,
  jadi path ikon apa pun yang tidak ada balas **200** dengan `text/html`. Pemeriksaan yang menguji
  ketersediaan lewat status code LULUS UNTUK IKON YANG TIDAK ADA. Karena itu `npm run cek:ikon:http`
  menguji `content-type: image/png` DAN sha256 body terhadap berkas yang di-commit — dan membawa
  kontrol positif: `/ikon/tidak-ada.png` harus DITOLAK oleh aturan yang sama.

Peringatan ini bukan teori. Pada tree ini, sesudah `npm run build` tanpa merestart `wrangler dev`
yang lama, `/assets/index-BhTOPOVU.js` balas `200 text/html; charset=utf-8` — nama file itu memang
tidak ada lagi di disk, jadi SPA fallback mengirim `index.html`, browser menolak modulnya, dan
aplikasi jadi layar kosong tanpa satu pun error HTTP. Yang kelihatan adalah 200; yang membuktikan
adalah content-type.

## Bukti di browser: satu PNG per layar

Gerbang C6 dulu cuma prosa. Sekarang artefaknya ikut di-commit di `bukti/`, diambil dengan
Playwright (Chromium 157) pada viewport 390×844, `deviceScaleFactor` 2 → semua berkas 780×1688,
dari `wrangler dev --local` yang menyajikan `dist` di `http://localhost:8791`:

```
d6dadb64b182d0d16032b6690b5f3a4d9ea51a39680e6eca3ecd49d29c6234a9  bukti/b1-start.png
1b8dc021b826f99682c710a7f04eee11c06219e50fdd6413e8b30b189bdc39fc  bukti/b2-start-tautan-basi.png
c50fc319c08c5dc8d73532f5e543a4b50fa6777dfa67c257e483b5e3f95b7535  bukti/b3-pemimpin.png
0df3a74eae20ae7681e3ef3d0fec207dcc9a70a04a3fedf3e4038e1f995d26be  bukti/b4-pengikut.png
03d45264bf327aaa794d9da80648933e6f326f2f8cc9733d1433d566f5a55655  bukti/b5-alat-ukur.png
62661b5a69fd95b7f36686bc0b4bd62f7beadfccd4725db819311d5debb10f62  bukti/b6-pemimpin-2hp.png
f92f3bf401826e1ae1b68931b86aa7834f66c6659206b794221a1818f034fdda  bukti/b7-pengikut-2hp.png
```

- `b1-start.png` — layar Start di atas `#0b0b0f` dengan teks `#eee` dan tautan `#9cf`: bukti visual
  bahwa palet satu-tempat itu benar-benar terrender, bukan hanya ada di CSS.
- `b2-start-tautan-basi.png` — `/?sid=AB&tok=zz` (sid 2 karakter, tok bukan hex): peringatan `#f99`
  yang dihitung di **Warna layar** tampil di layar nyata, bukan di teori.
- `b3-pemimpin.png` / `b4-pengikut.png` — satu sesi yang sama, dua *context* browser terisolasi
  (dua `did` berbeda). Baris grid-nya identik: `bpm=120 anchor=1794714353561 running=true` di dua
  layar; tombol tempo aktif di pemimpin dan mati (`:disabled`) di pengikut. Angka `1 HP` vs `2 HP`
  di dua layar itu bukan salah potong — itu potret BUG-nya, diambil pada tree sebelum T6 dibereskan;
  versi sesudahnya `b6`/`b7`. Mengambil ulang resep di bawah hari ini akan memberi `2 HP` di `b3`.
- `b5-alat-ukur.png` — DebugScope: `secureContext=true`, `wakeLock=true`, `serviceWorker=true` di
  browser bukti (di HP asli wake lock pernah `NotAllowedError`, dan itu yang belum terukur).
- `b6-pemimpin-2hp.png` / `b7-pengikut-2hp.png` — bukti bahwa angka HP bukan lagi snapshot. Sesi
  yang sama, dua *context* terisolasi: pemimpin menekan **Start** lebih dulu, pengikut masuk
  belakangan. Status pemimpin `120 BPM · jalan · 1 HP` → `120 BPM · jalan · 2 HP`, dan yang
  membuktikan ia TIDAK sambung ulang adalah pencatat di dalam context-nya:
  `opened=1, welcome=1, state=[1,1,2]` (satu socket, satu welcome, tiga state — join dirinya,
  siaran Start, siaran join pengikut) sementara diagnostiknya terus menghitung
  `klik 5 berbunyi · 0 hilang` → `klik 12 berbunyi · 0 hilang` dengan
  `anchor=1794715757496` yang sama persis di kedua layar. `tok` pada tautan join disensor di DOM
  sebelum potret diambil — tautan itu kunci sesi — `sid` sengaja dibiarkan.

Artefak ini juga yang menemukan satu bug: `b5` pertama kali keluar 792×1658, artinya kontennya
melebar 6 px dari viewport. Penyebabnya `textarea.fill { width: 100% }` tanpa `box-sizing`, jadi
padding + border bawaan menambah lebar — sekarang ada reset `box-sizing: border-box` di
`src/global.css` dan semua layar terukur `scrollWidth == innerWidth == 390`.

Cara mengambil ulang, urut persis seperti yang dijalankan (viewport 390×844, dsf 2, `fullPage`):
(1) `/` → `b1`; (2) `/?sid=AB&tok=zz` → `b2`; (3) kembali ke `/`, klik **"Buat sesi baru (saya
pemimpin)"**, klik **"Buat sesi & bunyikan klik"**, baca `p.pre` pertama = tautan join; (4) context
KEDUA (terisolasi, jadi `did`-nya beda) buka tautan itu, klik **"Masuk ke sesi …"**; (5) klik
**"Start"** di pemimpin, tunggu, → `b3` dan `b4`; (6) `/?layar=ukur` → `b5`; (7) untuk `b6`/`b7`:
ulangi (3)–(5) dengan `window.WebSocket` dibungkus pencatat frame lewat `addInitScript` di KEDUA
context, pemimpin menekan **Start** SEBELUM pengikut masuk (kalau tidak, siaran join-nya terlewat
dari yang sedang dilihat), tunggu dua detik, sensor `tok` di `p.pre`, lalu potret kedua layar.
`playwright` sengaja
tidak dijadikan dependency proyek — ia alat bukti, bukan bagian dari runtime aplikasi — jadi yang
dipakai adalah browser yang sudah ada di mesin ini. Mesin ini PUNYA jalur browser, jadi tidak ada
KETERBATASAN "tidak bisa menjalankan browser" di gerbang ini; yang belum terukur adalah HP asli
(lihat **Deploy spike** dan tugas lapangan M0).

## Deploy spike ke akun sendiri (M0 lapangan)

Angka keputusan M0 hanya bisa diambil dari HP di tempat latihan, jadi spike ini harus hidup di
URL asli. Akun Workers Free cukup — tidak ada yang perlu dibayar.

```
npm run login                    # buka browser, otorisasi OAuth; cek: npx wrangler whoami
npm run check                    # typecheck + lint:arch + 100 tes unit + 20 tes worker, harus hijau
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
   Lalu **analisisnya** — ini bagian yang dulu tidak tertulis, sehingga angkanya tidak bisa
   diulang orang lain. Semua perintah di bawah jalan ke `tail.log` hasil langkah pertama, dan
   window yang dipakai adalah seluruh berkas:
   ```
   stat -c%s tail.log                            # ukuran artefak, supaya window-nya jelas
   grep -c '"eventTimestamp":' tail.log          # jumlah entri yang benar-benar tertangkap
   grep -oE '"url": *"[^"]*/ws\?[^"]*"' tail.log | wc -l     # handshake yang membawa query string
   grep -o 'tok=' tail.log | wc -l               # semua kemunculan tok
   grep -o 'tok=REDACTED' tail.log | wc -l       # ...yang tersensor platform
   grep -oE 'tok=[0-9a-f]' tail.log | wc -l      # kendali negatif: harus 0
   grep -o 'sid=NCFB' tail.log | wc -l           # kendali positif: URL memang tercatat
   grep -o 'cf-connecting-ip' tail.log | wc -l   # header ikut tercetak = jumlah field "url"
   grep -oE '"status": *[0-9]+' tail.log | sort | uniq -c    # bauran status whole-file
   ```
   Empat angka terakhir itu adalah T9c. Capture 13 Nov 2026 yang tersisa di disk menjawab
   33 / 33 / **0** untuk tiga baris token dan 10 untuk kendali positif; tabel lengkap, status
   per path, dan angka sisi penyerang (`prod-attack.log`) ada di bagian **Gerbang keamanan M0**
   di atas. Catatan penting dari ukur yang sama: stream `wrangler tail` bocor (hanya sebagian
   entri sampai), jadi tes ini tidak boleh dibaca sebagai audit log — dan kalau dua instance
   tail jalan paralel seperti `tail.log` + `tail2.log`, angka keduanya tidak boleh dijumlahkan.
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
