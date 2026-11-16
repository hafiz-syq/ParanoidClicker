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
`b9fc0f3` (kode §4 rencana M3a). Tidak ada dependensi baru, tidak ada deploy, tidak ada push, tidak
ada perintah DDL ke produksi.

### Kontrak yang berubah di wire

| Yang lama | Yang sekarang | Di mana |
|---|---|---|
| `/create` → `{sid, token, wsPath}` | → `{sid, token, leaderKey, wsPath}`; `leaderKey` 64 hex hanya di JSON ini, `wsPath` (yang disalin ke tautan join, nanti jadi QR) tidak memuatnya | `src/worker/index.ts:39` |
| `tempo`/`start`/`stop` dari socket mana pun diterima | dijaga `assertLeader`; yang bukan pemegang podium dijawab `{t:'error',code:'NOT_LEADER'}` dan keadaan ruangan tidak tersentuh satu byte pun | `SessionDO.ts:182`, dipakai di `:275` (`tempo`) dan `:286` (`start`/`stop`) |
| tidak ada frame `claim` | frame masuk baru `{t:'claim', lk}` — `lk` diverifikasi ULANG dari frame, hasil `hello` tidak dipercaya; sah → `leaderDid` pindah + `state` disiarkan | `SessionDO.ts:193-201` |
| `members` = `SELECT COUNT(*) FROM member` (riwayat siapa yang pernah masuk) | `members` = jumlah socket `OPEN` di DO; angka itu sekarang bisa TURUN | `SessionDO.ts:153-159`, dipakai di `:105` (gerbang `FULL`), `:134` (`welcome`), `:240` (`state`) |
| `state` hanya disiarkan saat tempo/transport/perubahan anggota | `webSocketClose` ikut menyiarkan | `SessionDO.ts:310-319` |
| `leader` = peran dari URL | `leader` = punya `lk` DAN server belum menjawab `NOT_LEADER`; tombol "Ambil kendali" lahir dari penolakan itu | `ClickRoom.tsx:43-44`, `:62`, `:167`, `:315-318` |

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
  `welcome`. Apakah socket dihitung per `did` unik masih **[TANYA]** — dan karena itu tidak ada satu
  pun tes yang mengasumsikan dedupe. Kalau jawabannya "ya", dua tempat yang berubah: gerbang `FULL`
  (`SessionDO.ts:105-106`) dan `members` di `welcome` (`:134`).
- **Gagal tertutup.** Tanpa baris `leader` tidak ada yang boleh memerintah. Konsekuensi hari deploy
  yang harus dibaca sebelum klien dikirim ke HP: HP yang sudah ter-install dan tidak mengirim `lk`
  masuk sebagai anggota biasa — termasuk HP pemimpin, karena `leaderKey` baru lahir hari itu.
  Sesi yang dibuatnya tidak pernah mengikat `did` apa pun, jadi seluruh `tempo`/`start`/`stop`
  miliknya dijawab `NOT_LEADER` sampai klien-nya diperbarui. Jalur pemulihannya ada di layar:
  "Ambil kendali" (`ClickRoom.tsx:315-318`) hanya muncul kalau HP itu memegang `lk`.
- `hello` pemimpin TIDAK menulis SQLite lagi kalau podium sudah terikat (`SessionDO.ts:125-127`):
  `claimed_at` tetap jam podium benar-benar direbut, dan reconnect tidak membayar kuota tulis.

### BELUM di M3a

- Gerbang rencana §7 butir "ukur di stack hidup DUA perangkat" **belum dikerjakan**: pengikut yang
  memaksa `tempo` dari layar → `NOT_LEADER` terlihat, `bpm`/`anchor` kedua layar tetap identik,
  `0 hilang` tidak berubah, dan `N HP` TURUN saat satu perangkat ditutup. Yang terbukti hari ini
  adalah jalur itu di socket (`T12a`/`T12b`) dan di layar lewat unit test, bukan di dua HP.
- Setlist (tabel, layar, frame-nya sendiri) keluar ke **M3b** — bukan pekerjaan yang tertinggal.
- QR menyusul di M4; sampai itu terjadi, tautan join tetap kunci ruangan: siapa pun yang membukanya
  bisa masuk, dan hari ini ia masuk sebagai anggota.

## Antrean defect yang belum punya gerbang

Ditulis di sini supaya tidak menguap jadi log percakapan. Tidak satu pun boleh masuk changelog
M3a sebagai "diperbaiki" tanpa tes, dan angka yang bukan hasil ukur saya sendiri saya labeli
sumbernya.

1. **`scripts/**` tidak masuk project tsconfig mana pun.** `tsconfig.app.json` hanya mengambil
   `src/app|screens|shared`, `tsconfig.worker.json` hanya `src/worker|shared` plus dua `.d.ts`,
   dan `tsconfig.json` di root isinya cuma `references` ke dua berkas itu — dibaca langsung,
   16 Nov 2026. Jadi `scripts/attack.ts`, `smoke-ws.ts`, `lint-arch.ts`, dan `gerbang.spec.ts`
   tidak pernah di-typecheck oleh `npm run check`. **Pilihan pemilik (S2) atas label opsi yang saya
   tulis: "Jangan pasang, tunda" (`@types/node`)** — kanalnya AskUserQuestion, jam 2026-11-15T18:46:12Z
   = 2026-11-16 01:46 WIB, alamat lengkap di baris S2 tabel §KOREKSI; tanggal "16 Nov" di kalimat lama
   adalah tanggal WIB, bukan UTC. Pertanyaannya sendiri masih terbuka: prompt checker 2026-11-16/17
   (S6) mencatat "`@types/node` belum dijawab → jangan pasang", jadi tidak ada yang menugaskan saya
   memasang ulang, dan menunda bukan berarti menolak permanen.
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

1. **`apple-touch-icon` = permukaan APLIKASI** (S4) — pemilik menjawabnya 2026-11-16 23:50 WIB
   (`via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:50:13.874Z`, S4): tetap
   `paranoid-180.png` (mark lama berbingkai). Jawaban itu sampai ke sesi ini **dirolay lewat prompt
   checker**, bukan sebagai turn saya sendiri — itu sebabnya penanda sumbernya menunjuk sesi lain.
   Konsekuensinya di kode: NOL. `scripts/gerbang-ikon.mjs` tidak saya ubah; klasifikasi yang sudah
   ada di dalamnya (`web` HANYA untuk `index.html rel="icon"`) ternyata persis cocok dengan jawaban
   ini, jadi yang berubah cuma catatan di README/rencana.
2. **Mark di dalam layar** (README bagian "Ikon & shell PWA") — masih `[TANYA]`. Kotak M3a memang
   terbuka (S4), tapi "boleh menyentuh `src/`" tidak sama dengan "putuskan logonya", dan tema itu
   tercatat bersama M7.
3. **`og:image` belum ada sama sekali** — masih `[TANYA]`. Menambahkannya berarti (a) satu gambar
   1200×630 yang layout-nya belum diputuskan dan (b) URL absolut ke produksi — dan itu tidak bisa
   kubuktikan dari sini tanpa deploy, yang tidak diizinkan (S5).


## KOREKSI 2026-11-16 — kalimat yang menyebut pemilik ditulis tanpa alamat

Sesi checker menemukan (S6) bahwa commit `1a30bba` (2026-11-16 01:50 WIB = 2026-11-15T18:50Z)
menuliskan atribusi tanpa satu pun alamat yang bisa ditunjuk, lalu menyimpulkan tidak ada yang pernah
menjawabnya. Kesimpulan itu sebagian salah, dan bagian yang benar adalah cacat yang nyata: **jawabannya
ada, kanalnya yang tidak ditulis.** Tiga jawaban itu datang lewat alat `AskUserQuestion`, yang hasilnya
masuk sebagai `tool_result` di sesi saya — bukan sebagai turn chat — sehingga daftar turn yang dibaca
checker memang tidak bisa melihatnya. Yang saya perbaiki di sini bukan isinya, tapi alamatnya.

Yang tidak berubah karena koreksi atribusi ini, diukur di tree:

```
$ for r in eaf5e63 1a30bba 452488c; do printf '%s ' $r; git show $r:docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md | grep -c "^- \[x\]"; done
eaf5e63 5
1a30bba 5
452488c 5
$ grep -c "^- \[x\]" docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md   # worktree sesudah S4 dibuka
6
```

Lima `[x]` + satu `[ ]` (kotak kode M3a) di ketiga commit: tidak ada kotak yang berpindah status di
`1a30bba`, jadi klaim "satu kotak `[ ]` → `[x]` tanpa ada yang mencentang" salah dan saya koreksi
dengan angka di atas. Angka `6` di worktree bukan hasil koreksi ini juga — kotak kode baru dicentang
setelah jawaban pemilik S4 (`via 2d6f4ca7@2026-11-16T16:50Z`) datang dirolay prompt checker.

Koreksi ini ditulis sebagai commit ke depan. `1a30bba` tidak di-amend dan tidak di-rebase: dua sesi
bekerja di satu working tree, dan menulis ulang history yang sudah dilihat sesi lain justru
menghancurkan jejak yang lagi diperiksa.

Aturan dari checker (S6): setiap baris yang memuat kata pemilik di sebelah salah satu dari
keputusan/perintah/instruksi/syarat/jawaban/konfirmasi — di `README.md`, `docs/plans/**`, atau
`docs/adr/**` — harus membawa salah satu: `[TANYA]`, alamat
`via <sessionId>@<UTC>`, atau kunci `S<n>` yang baris tabelnya di berkas yang sama membawa alamat. Penegaknya assertion
`setiap klaim keputusan pemilik di dokumen membawa alamat sumber yang bisa ditunjuk` (S6) di
`scripts/gerbang.spec.ts`, jalan di `npm run check` tanpa perlu ada yang mengingat perintahnya
([TANYA]: penjaga ini cuma memeriksa BENTUK alamat. Berkas transcript di `~/.qoder/projects/*.jsonl`
diblokir untuk dibaca sejak tugas ini berjalan, jadi tidak ada assertion yang bisa membuktikan
isi sebuah jawaban — hanya bahwa jawabannya menunjuk ke suatu tempat).

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
| S4 | jawaban pemilik dua pertanyaan di sesi checker: **kotak kode M3a dibuka** ("lanjutkan ke tahap selanjutnya") + **`apple-touch-icon` = permukaan APLIKASI** (`paranoid-180.png` tetap, `gerbang-ikon.mjs` jangan disentuh) | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T16:50:13.874Z | pemilik menjawab di sesi 2d6f4ca7 23:50 WIB; isinya sampai ke saya **dirolay prompt checker**, bukan sebagai turn di sesi ini |
| S5 | aturan berdiri: `JANGAN deploy`, `JANGAN push`, tulis ke produksi butuh izin eksplisit, larangan skill `vercel-deploy`, larangan commit `tail*.log` | via d27c1add-d9ec-4675-b6e8-2044f92eae20@2026-11-15T18:38:43Z | turn `CHECKER → EXECUTOR` yang memetik aturan pemilik; jamnya dilaporkan sesi checker, saya tidak mengukur ulang |
| S6 | dua prompt checker: (a) temuan provenance atas `1a30bba` + tuntutan assertion penjaga, (b) arahan M3a B0–B4 yang menyatakan **pemilik TIDAK menjawab tafsir `did` unik** (pakai socket mentah) dan **`scripts/gerbang-ikon.mjs` jangan diubah** | via 2d6f4ca7-3aba-44e4-ab8d-470daf00b560@2026-11-16T17:32:47Z [TANYA] | keduanya masuk ke sesi saya sebagai pesan; jam di alamat itu adalah hasil `node -e "console.log(new Date().toISOString())"` pada saat saya membaca promptnya (`2026-11-16T17:32:47.248Z`, offset `-420`) — bukan timestamp turn di sesi checker, dan transcript tidak bisa dibuka untuk membuktikannya |

Satu hal yang sengaja saya biarkan terbuka, bukan saya putuskan: catatan S2 bilang sebuah label opsi
*"did unik di antara socket hidup"* pernah dipilih, sementara prompt checker menyatakan pertanyaan
tafsir §6.2 itu belum dijawab pemilik (S6). Yang saya kerjakan mengikuti yang harfiah dari jawaban
15 Nov (S1): **jumlah socket hidup MENTAH** dari `getWebSockets()`, tanpa dedupe `did`. Konsekuensinya
yang harus dibaca pemilik sebelum menjawab (S6) — dengan socket mentah, satu HP yang network-nya flap
atau reload memakan **2 kursi**, jadi ruangan 12 HP bisa menjawab `FULL` dengan 11 HP nyata di tengah
latihan. Dua tes yang berubah kalau jawabannya "ya": gerbang `FULL` dan `members` di `welcome`.

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
