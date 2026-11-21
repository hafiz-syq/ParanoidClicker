# Protokol uji lapangan HP asli

**Tanggal**: 21 November 2026
**Status**: **PROTOKOL SAJA** — belum dijalankan, belum ada angka hasil, dan tidak ada
perubahan kode/UI/deploy dalam dokumen ini.
**Cakupan**: cold start offline dari ikon terpasang, mode pesawat, perilaku storage iOS, dan
pengukuran offset klik dua HP dengan satu mikrofon.
**Bukan cakupan**: mengukur latency absolut tanpa loopback, menjamin storage iOS tidak pernah
dihapus, atau menyimpulkan sinkroni seluruh band dari dua HP.

Dokumen rujukan yang lebih dalam:

- `docs/plans/2026-11-21-m6-protokol-ukur-dua-hp.plan.md` — protokol akustik Δ(A−B), ambang,
  dan batas satu mikrofon.
- `README.md` §“Service worker M7” — kebijakan cache, update yang menunggu, dan batas offline.
- `README.md` §“Ikon & shell PWA” — ikon, manifest, dan status pengujian PWA.

## Alur singkat

1. Pasang kedua HP dari origin HTTPS, buka sekali online sampai cache lengkap, dan catat build/SW.
2. Lakukan satu cold start online; hentikan aplikasi sepenuhnya sebelum setiap percobaan.
3. Nyalakan mode pesawat, lalu cold start dari ikon tiga kali; catat shell, waktu, dan build.
4. Ulangi pengecekan storage iOS untuk force quit, reboot, dan (bila dilakukan) reset.
5. Nyalakan jaringan, buat sesi dua HP, rekam G1/G2 dengan satu mikrofon, lalu hitung Δ.
6. Isi lembar angka dan status; simpan WAV asli dan jangan mengubah ambang setelah melihat hasil.

## 0. Aturan dasar

1. **Gunakan origin HTTPS yang sudah di-deploy.** Ikon terpasang, service worker, dan cold start
   offline tidak sah diuji dari `localhost` atau HTTP. Kalau deployment belum tersedia, isi
   status run dengan `BELUM`, jangan menggantinya dengan preview lokal.
2. **Satu tab/aplikasi per HP.** Tutup tab ParanoidClick lain di HP yang sama. Kalau build yang
   diuji sudah memuat penjaga `BroadcastChannel`, tab kedua akan menampilkan peringatan “Tab
   ParanoidClick lain…”; tutup tab itu dan ulangi run.
3. Kedua HP harus memakai **build/SW yang sama**. Catat badge `SW build` di layar. Jangan mulai
   take kalau ada banner “Versi baru sudah siap” atau SW baru menunggu.
4. **Jangan membersihkan cache/storage** sebelum baseline. Pembersihan hanya boleh menjadi
   skenario reset yang dicatat sebagai reset, bukan cara “memperbaiki” hasil.
5. Satu run mengubah satu variabel. Jangan menggabungkan mode pesawat, update build, dan
   pengukuran offset dalam satu take.
6. Catat semua run, termasuk yang gagal. Jangan memilih hanya hasil yang paling bagus.
7. **Offline cold start hanya membuktikan shell tampil.** Membuat sesi, join, dan menerima grid
   tetap butuh server. Setelah cold start offline, tab baru belum punya state grid terakhir; itu
   batas yang sudah diketahui, bukan kegagalan protokol ini.
8. Pengukuran offset dilakukan **online** (atau pada jaringan lokal yang memang dikendalikan),
   bukan saat mode pesawat. Selesaikan uji offline dulu, nyalakan jaringan, lalu ukur offset.

## 1. Peralatan dan persiapan

### 1.1 Peralatan minimum

- Dua HP yang akan dipakai band; keduanya sudah dipasang sebagai aplikasi ke layar utama.
- Satu mikrofon pengukur pada stand, bukan mikrofon salah satu HP.
- Recorder/interface yang bisa merekam **WAV PCM 48 kHz/24-bit mono**, tanpa kompresi, AGC,
  noise reduction, atau efek.
- Stopwatch (boleh stopwatch HP lain; jangan memakai HP yang sedang diuji).
- Meteran/pita untuk jarak speaker–mikrofon; lakban atau penanda posisi.
- Kain peredam untuk meja, ruangan yang jauh dari AC/kipas/lalu lintas.
- Opsional: loopback listrik (splitter output ke line-in recorder) hanya untuk pengukuran absolut.
  Tanpa loopback, kolom absolut diisi `tidak diukur`.

### 1.2 Identitas run

Buat satu lembar identitas untuk setiap run. Contoh format (bukan data):

| Bidang | Isi |
|---|---|
| Run ID | `F-20261121-01` |
| Waktu mulai | `2026-11-21T14:03:00+07:00` |
| Operator |  |
| Lokasi/ruangan |  |
| Origin yang dipasang | `https://…` (bukan localhost) |
| Build/SW A |  |
| Build/SW B |  |
| HP A | model / OS / browser |
| HP B | model / OS / browser |
| Mode pemasangan A/B | PWA standalone / tab browser |
| Jaringan | Wi-Fi / seluler / mode pesawat |
| BPM sesi |  |
| Mikrofon + recorder |  |
| Gain recorder |  |
| Jarak speaker–mic `d` | cm |
| Catatan |  |

Gunakan waktu lokal **dan** offset zona waktu. Untuk angka desimal, pakai titik (`12.4 ms`);
jangan mencampur koma dan titik dalam satu tabel.

### 1.3 Persiapan tiap HP

Catat dan seragamkan sebelum baseline:

| Hal | HP A | HP B |
|---|---|---|
| Model |  |  |
| Versi OS |  |  |
| Browser yang dipakai memasang |  |  |
| Mode terpasang (standalone?) |  |  |
| Sisa storage perangkat |  |  |
| Baterai / sedang dicas? |  |  |
| Rute keluaran (speaker/earpiece/kabel) |  |  |
| Volume media |  |  |
| Bluetooth/TWS | mati | mati |
| Notifikasi, alarm, getaran | mati | mati |
| Auto-lock / wake lock |  |  |
| Orientasi dan casing |  |  |

- Lepas casing yang menutup speaker; jangan menutup port speaker dengan tangan.
- Jangan memakai headset Bluetooth untuk uji speaker. Bluetooth harus mati.
- Matikan mode hemat baterai/adaptive battery yang bisa membekukan audio.
- Jangan mencas HP saat take akustik; charger dapat menambah noise.
- Pastikan tidak ada aplikasi audio lain yang berbunyi.

## 2. Fase A — pasang, baseline, dan cold start online

Fase ini membuktikan bahwa ikon benar-benar membuka aplikasi terpasang dan cache sudah lengkap
**sebelum** jaringan dimatikan.

### 2.1 Pasang di Android

1. Buka origin HTTPS di Chrome.
2. Tunggu sampai layar depan tampil penuh. Jangan menekan tombol jaringan apa pun.
3. Pasang lewat banner “Pasang” bila muncul, atau menu Chrome → **Install app / Tambahkan ke
   layar utama**.
4. Buka dari ikon layar utama. Pastikan tidak ada address bar dan aplikasi tampil sebagai
   standalone.
5. Tunggu sampai badge `SW build` muncul dan tidak ada bar “Precache tidak lengkap”.
6. Catat build/SW dan mode pemasangan.

### 2.2 Pasang di iOS

1. Buka origin HTTPS di **Safari**, bukan browser lain.
2. Tunggu sampai layar depan tampil penuh.
3. Tekan **Bagikan** → **Tambahkan ke Layar Utama** → **Tambah**.
4. Buka dari ikon layar utama. Pastikan tidak ada address bar Safari; kalau masih ada address
   bar, aplikasi belum berjalan standalone dan run tidak sah untuk uji “dari ikon terpasang”.
5. Kalau petunjuk “Tambahkan ke Layar Utama” muncul, ikuti; jangan menutupnya lalu menganggap
   sudah terpasang.
6. Tunggu badge `SW build` dan pastikan tidak ada bar precache gagal/update.

### 2.3 Baseline online

1. Buka aplikasi terpasang di kedua HP **secara online**.
2. Tunggu sampai cache selesai. Bukti yang dicatat:
   - `SW build` menampilkan hash (bukan “versi SW aktif tidak menjawab”);
   - tidak ada “Precache tidak lengkap”;
   - tidak ada tawaran “Versi baru sudah siap” yang belum diputuskan.
3. Kalau ada versi baru, selesaikan update di **kedua** HP sebelum baseline, lalu ulangi dari
   langkah 1. Jangan mengaktifkan update di tengah pengukuran.
4. Lakukan satu **cold start online** sebagai kontrol:
   - hentikan aplikasi sepenuhnya (lihat 2.4);
   - buka dari ikon sambil online;
   - catat waktu sampai layar pertama tampil.
5. Baru setelah kontrol online ini berhasil, lanjut ke uji offline.

### 2.4 Hentikan aplikasi dengan benar (cold start)

Ini bukan sekadar pindah ke aplikasi lain.

- **iOS**: buka app switcher, geser aplikasi ParanoidClick ke atas sampai hilang. Tunggu satu
  detik. Untuk memastikan, buka aplikasi lain lalu kembali ke layar utama.
- **Android**: buka Recent apps, geser keluar; atau Settings → Apps → ParanoidClick → **Force
  stop**. Pastikan tidak ada tab/aplikasi ParanoidClick yang masih terlihat.

Kalau aplikasi hanya di-background, itu **bukan** cold start dan tidak boleh dicatat sebagai
cold start.

## 3. Fase B — cold start offline dari ikon terpasang

### 3.1 Menyalakan mode pesawat

Lakukan sebelum membuka aplikasi.

**iOS**

1. Settings atau Control Center → **Airplane Mode**.
2. Pastikan **Wi‑Fi mati**, **Bluetooth mati**, dan VPN mati. Airplane Mode kadang meninggalkan
   Wi‑Fi menyala bila diaktifkan dari Control Center; periksa kembali.
3. Tunggu minimal 10 detik.
4. Verifikasi tidak ada jaringan dari aplikasi lain (misalnya buka satu halaman web di browser
   lain). Jangan membuka ParanoidClick dulu.

**Android**

1. Quick Settings → **Airplane mode**.
2. Matikan Wi‑Fi, data seluler, Bluetooth, dan VPN secara terpisah; jangan hanya mengandalkan
   ikon pesawat.
3. Tunggu minimal 10 detik dan verifikasi tidak ada jaringan.

Catat metode yang dipakai dan waktu verifikasi. Kalau ada Wi‑Fi kafe yang otomatis tersambung,
matikan auto-join atau lupakan jaringan sebelum run.

### 3.2 Langkah cold start offline

1. Pastikan aplikasi sudah dihentikan sepenuhnya (2.4) dan tidak ada tab lama yang terbuka.
2. Pastikan mode pesawat aktif dan sudah diverifikasi.
3. Mulai stopwatch pada saat jari menyentuh ikon.
4. Buka ParanoidClick **dari ikon layar utama**, bukan dari browser, bukan dari tautan.
5. Catat waktu sampai layar pertama yang bisa dibaca muncul. Jangan menekan tombol jaringan
   sebelum angka ini dicatat.
6. Periksa dan catat:
   - apakah tampil standalone tanpa address bar;
   - layar apa yang muncul (Start, ClickRoom, atau blank);
   - badge `SW build` (hash / “tidak menjawab” / kosong);
   - ada tidaknya “Precache tidak lengkap” atau banner update;
   - ada tidaknya tombol “Lanjut ke sesi …”;
   - saat menekan aksi yang butuh server, apakah muncul pesan gagal yang bisa dibaca atau
     menggantung.
7. Ulangi minimal **tiga kali** dengan force-stop baru setiap kali. Jangan menghapus cache di
   antara run.
8. Setelah selesai, nyalakan kembali jaringan dan tunggu satu menit. Jangan menekan “Muat ulang”
   pada banner update sebelum data run dicatat.

### 3.3 Yang diharapkan dan yang tidak

- **Diharapkan**: shell dari cache tampil, ikon membuka standalone, dan tidak ada layar blank.
- **Diharapkan**: aksi yang membutuhkan worker (buat sesi, join, perubahan tempo) gagal dengan
  pesan, bukan diam tanpa penjelasan.
- **Tidak diharapkan sebagai bagian uji ini**: grid atau klik langsung berjalan setelah cold start
  offline. State grid terakhir tidak dipersistenkan; tab baru menunggu `state` server.
- Kalau shell tampil tetapi badge build kosong, catat sebagai temuan; jangan mengisi hash karangan.

### 3.4 Lembar cold start

Isi satu baris per percobaan.

| Run | HP | Mode henti | Pesawat terverifikasi | Waktu sampai shell (s) | Standalone? | Layar pertama | SW build | Bar precache/update | Aksi offline | Status | Catatan |
|---|---|---|---:|---|---|---|---|---|---|---|---|
|  | A | force stop | ya/tidak |  | ya/tidak | Start/room/blank |  |  |  | LULUS/GAGAL/TIDAK SAH |  |
|  | B | force stop | ya/tidak |  | ya/tidak | Start/room/blank |  |  |  | LULUS/GAGAL/TIDAK SAH |  |

**Status cold start**

- **LULUS**: setelah force-stop dan mode pesawat terverifikasi, ikon membuka aplikasi standalone
  dan shell terbaca dari cache; tidak ada blank/error halaman browser.
- **GAGAL**: blank, halaman error browser, ikon tidak membuka aplikasi, atau shell hanya muncul
  setelah jaringan dinyalakan.
- **TIDAK SAH**: aplikasi tidak benar-benar dihentikan, mode pesawat tidak lengkap, build berubah,
  atau cache dibersihkan sebelum run. Ulangi; jangan masukkan ke hitungan lulus/gagal.

## 4. Fase C — storage iOS

Tujuan fase ini adalah **mencatat** apakah cache dan localStorage bertahan, bukan menjanjikan
bahwa iOS tidak akan pernah menghapusnya. iOS dapat membuang data situs/aplikasi web di bawah
tekanan storage atau karena kebijakan OS; hasilnya bisa berbeda menurut versi iOS dan kondisi HP.

### 4.1 Skenario

Jalankan berurutan. Jangan menghapus data sebelum baseline.

| Skenario | Tindakan | Yang dicatat |
|---|---|---|
| S1 — force quit singkat | Tutup PWA sepenuhnya, tunggu 1 menit, mode pesawat, buka ikon | shell, build, “Lanjut ke sesi”, cache/precache bar |
| S2 — reboot | Reboot HP tanpa menghapus data, tetap mode pesawat setelah hidup, buka ikon | sama seperti S1; catat waktu dari reboot sampai layar |
| S3 — jeda/perangkat storage rendah (opsional) | Biarkan terpasang tanpa dipakai (mis. 24 jam) atau gunakan HP yang memang storage-nya rendah; **jangan mengisi disk dengan sengaja** | kondisi storage, lama jeda, shell, build, session marker |
| S4 — reset destruktif (terakhir) | Hapus ikon dan/atau bersihkan data situs/Safari, lalu pasang ulang online | ini reset, bukan baseline; catat bahwa data memang dihapus (efek persisnya bisa berbeda menurut versi iOS) |

Untuk S1/S2 jangan membuka aplikasi sebelum mode pesawat aktif. Untuk S2, reboot boleh dilakukan
saat mode pesawat masih aktif; setelah hidup, verifikasi Wi‑Fi/seluler tetap mati.

### 4.2 Cara membaca hasil iOS

Bedakan dua hal:

- **Shell/cache**: apakah layar tampil offline tanpa jaringan.
- **Session marker/localStorage**: apakah tombol “Lanjut ke sesi …” masih ada.

Satu bisa bertahan tanpa yang lain. Gunakan status:

- **PERSISTEN** — shell offline dan marker sesi masih ada seperti baseline.
- **SEBAGIAN** — salah satu bertahan, yang lain hilang; tulis yang mana.
- **HILANG** — shell offline tidak bisa dimuat dan marker sesi hilang; catat apakah ada pesan
  precache/update.
- **TIDAK SAH** — aplikasi tidak standalone, tidak benar-benar ditutup, atau jaringan masih aktif.

**Penting**: `HILANG` setelah reset S4 adalah hasil yang diharapkan dari reset, bukan bukti
storage iOS “rusak”. `HILANG` setelah S1/S2 adalah temuan yang harus dicatat sebagai risiko
lapangan. Setelah storage hilang, pemulihan cache membutuhkan jaringan; jangan mengisi kolom
offline sebagai lulus hanya karena aplikasi bisa dibuka online.

### 4.3 Lembar iOS storage

| Run | Skenario | Force quit/reboot | Jeda | Jaringan benar-benar mati? | Shell offline | SW build | “Lanjut ke sesi” | Bar precache | Status | Catatan |
|---|---|---|---:|---|---|---|---|---|---|---|
|  | S1 | force quit | 1 mnt | ya/tidak | ya/tidak |  | ya/tidak |  | PERSISTEN/SEBAGIAN/HILANG/TIDAK SAH |  |
|  | S2 | reboot |  | ya/tidak | ya/tidak |  | ya/tidak |  | PERSISTEN/SEBAGIAN/HILANG/TIDAK SAH |  |
|  | S3 | force quit | 24 jam | ya/tidak | ya/tidak |  | ya/tidak |  | PERSISTEN/SEBAGIAN/HILANG/TIDAK SAH |  |
|  | S4 | reset destruktif |  | ya/tidak | ya/tidak |  | ya/tidak |  | PERSISTEN/SEBAGIAN/HILANG/TIDAK SAH |  |

Catat juga sisa storage perangkat sebelum dan sesudah S3. Jangan memakai angka sisa storage
sebagai pengganti status shell/session.

## 5. Fase D — offset klik dua HP dengan satu mikrofon

Fase ini **online**. Selesaikan Fase B/C dan nyalakan jaringan kembali. Jangan mencampur data
cold start offline dengan data akustik.

### 5.1 Apa yang diukur

Δ(A−B) adalah selisih waktu tiba klik HP A dan HP B di mikrofon yang sama:

- positif = klik A tiba **lebih lambat** dari B;
- negatif = klik A tiba lebih awal;
- satu mikrofon cukup untuk Δ relatif karena delay mikrofon/recorder dan jarak yang sama
  menghapus dirinya sendiri;
- satu mikrofon **tidak** mengukur latency absolut keluaran HP. Jangan menulis
  `acousticLatency` absolut dari metode ini. Nilai absolut hanya boleh diisi bila ada loopback
  listrik.

### 5.2 Persiapan sesi dan HP

1. Tutup tab lain di kedua HP. Pastikan tidak ada peringatan tab duplikat.
2. Buka satu PWA terpasang di tiap HP; catat mode pemasangan.
3. Buat sesi dari HP A (pemimpin), masukkan HP B sebagai pengikut. Catat `sid`.
4. Pilih **satu BPM tetap**. Jangan memakai ramp, setlist, hitungan masuk, atau perubahan tempo
   selama take. Catat BPM.
5. Tunggu sampai kedua layar menunjukkan `2 HP`, `jalan`, `ctx=running`, `0 hilang`, dan tidak
   ada `terputus`/re-anchor selama take.
6. Matikan Bluetooth/TWS, notifikasi, alarm, getaran, dan suara sistem. Jangan memakai silent
   switch untuk mengatur volume; gunakan tombol volume media.
7. Pasang casing yang sama atau lepas keduanya; jangan menutup speaker.

### 5.3 Geometri dan mikrofon

Gunakan dua geometri:

- **G1**: HP A di kiri, HP B di kanan, mikrofon di tengah.
- **G2**: HP A dan B ditukar; mikrofon dan jarak tetap.

Letakkan mikrofon di tengah, kedua speaker menghadap mikrofon pada jarak yang sama. Tandai
posisi. Catat jarak `d` (cm). Jangan mengubah posisi di tengah take.

Atur recorder:

- WAV PCM 48 kHz/24-bit mono;
- tanpa AGC, kompresi, noise reduction, atau efek;
- gain tetap dan tidak clipping;
- uji 2–4 klik untuk memastikan level; buang klik uji dari analisis.

### 5.4 Urutan satu take

Lakukan satu take kontinu per geometri. Yang diubah hanya volume, bukan start/stop atau tempo.

1. Mulai recorder. Beri satu clap/ketukan penanda untuk orientasi; jangan pakai penanda itu untuk
   perhitungan.
2. Diam sebentar.
3. Set volume HP B ke nol. Verifikasi hanya A yang terdengar. Rekam **segmen A1: 8 ketukan**.
4. Set volume A ke nol, kembalikan volume B. Verifikasi hanya B yang terdengar. Rekam **segmen
   B1: 8 ketukan**.
5. Ulangi **A2: 8 ketukan**, lalu **B2: 8 ketukan**, masih dalam take yang sama.
6. Hentikan recorder. Jangan memotong atau menormalkan file sebelum checksum/catatan dibuat.
7. Tukar posisi HP ke G2, ulangi langkah 1–6. Jangan mengubah BPM, gain, atau volume dasar.

Kalau pergantian volume menghasilkan bunyi sendiri, atau dua klik terdengar bersamaan, buang satu
ketukan di sekitar transisi dan tandai segmen. Segmen yang tidak jelas tidak dipakai.

### 5.5 Analisis angka

1. Deteksi **onset** setiap klik pada waveform/spectrogram dengan ambang yang sama untuk semua
   segmen. Jangan memakai puncak absolut.
2. Mulai indeks ketukan `n = 0` dari klik pertama yang sah. Tambah satu untuk tiap ketukan.
3. Hitung:
   - `P_nominal = 60000 / BPM` (ms);
   - `P_ukur` = median interval antar ketukan berurutan yang terdeteksi;
   - catat `P_ukur − P_nominal`.
4. Untuk setiap klik sah: `residual = t_tiba − n × P_ukur`.
5. Ambil **median** residual untuk tiap HP dan tiap geometri. Jangan memakai rata-rata.
6. Hitung `Δ = median_A − median_B`. Tulis tanda dan satuan.
7. G2 harus memberi tanda yang sama. Kalau tanda berbalik, anggap geometri/ruangan tidak valid,
   bukan “offset nol”.
8. Periksa drift: bandingkan interval awal dan akhir take. Perubahan sistematis berarti take
   tidak sah; ulangi, jangan mengoreksi dengan asumsi drift.

### 5.6 Ambang keputusan

Ambang ini ditetapkan sebelum data diambil. Jangan mengubahnya setelah melihat hasil.

| Gerbang | Ambang |
|---|---|
| Cakupan segmen | ≥ 6 dari 8 klik sah per segmen |
| Outlier | ≤ 2 klik dibuang per segmen, dengan alasan |
| Clipping/noise | tidak ada sample clipping; onset jelas |
| Ulangan geometri | Selisih absolut ΔG1 − ΔG2 ≤ 5 ms |
| Kestabilan onset | MAD residual tiap segmen ≤ 3 ms |
| Offset relatif | Nilai absolut Δ gabungan ≤ 10 ms |
| Absolut (opsional) | `used ≥ 6`, `rejected ≤ 2`, nilai non-null; hanya dengan loopback |

Status:

- **SAH**: cakupan, clipping, onset, MAD, dan kestabilan take memenuhi syarat.
- **TIDAK SAH — ULANGI**: kurang klik, clipping, onset ambigu, ruangan bising, atau
  `|ΔG1 − ΔG2| > 5 ms`. Angka run ini tidak dipakai.
- **LULUS**: data SAH dan `|Δ gabungan| ≤ 10 ms`.
- **GAGAL**: data SAH tetapi `|Δ gabungan| > 10 ms`. Angka tetap dicatat; ini offset yang
  melewati ambang, bukan pengukuran yang tidak sah.

Jangan menerapkan Δ ke `setLatencyComp` sebagai bagian protokol ini. Keputusan kompensasi absolut
masih terpisah.

### 5.7 Lembar offset

**Tabel A — per HP**

| Bidang | HP A | HP B |
|---|---|---|
| Model / OS / browser |  |  |
| Build/SW |  |  |
| Peran | pemimpin | pengikut |
| Rute keluaran / volume |  |  |
| `baseLatency` (ms) dari `?layar=ukur` |  |  |
| `outputLatency` (ms) dari `?layar=ukur` |  |  |
| Posisi G1 / G2 |  |  |
| Jarak speaker–mic `d` (cm) |  |  |
| Segmen A1/A2: dipakai/dibuang |  |  |
| Segmen B1/B2: dipakai/dibuang |  |  |
| Median residual G1 (ms) |  |  |
| Median residual G2 (ms) |  |  |
| MAD residual G1/G2 (ms) |  |  |
| Status data G1/G2 |  |  |
| Absolut `acousticLatency.ms` | `tidak diukur` | `tidak diukur` |
| Absolut `used/rejected` | `NA` | `NA` |

`baseLatency`/`outputLatency` hanya diagnosis. Keduanya bukan pengganti Δ akustik.

**Tabel B — per geometri**

| Geometri | Median A (ms) | Median B (ms) | Δ = A−B (ms) | `P_nominal` (ms) | `P_ukur` (ms) | Sebaran/ulangan (ms) | Sah? | Catatan |
|---|---:|---:|---:|---:|---:|---:|---|---|
| G1 — A kiri, B kanan |  |  |  |  |  |  |  |  |
| G2 — A kanan, B kiri |  |  |  |  |  |  |  |  |
| Gabungan G1/G2 |  |  |  |  |  |  |  |  |

**Tabel C — gerbang**

| Gerbang | G1 | G2 | Hasil |
|---|---|---|---|
| Cakupan ≥ 6/8 |  |  |  |
| Outlier ≤ 2 |  |  |  |
| Clipping/noise |  |  |  |
| Nilai absolut ΔG1 − ΔG2 ≤ 5 ms |  |  |  |
| MAD ≤ 3 ms |  |  |  |
| Nilai absolut Δ gabungan ≤ 10 ms |  |  |  |
| Status akhir |  |  | LULUS/GAGAL/TIDAK SAH |

## 6. Format catatan angka

### 6.1 Konvensi

- Satu baris = satu run/segmen; jangan mencampur dua percobaan dalam satu baris.
- Timestamp: ISO 8601 dengan offset, mis. `2026-11-21T14:03:00+07:00`.
- Desimal memakai titik; satuan ditulis di judul kolom, bukan di setiap sel.
- Nilai yang tidak diukur: `NA`. Nilai yang tidak sah: `TIDAK SAH` di kolom status.
- Δ selalu bertanda (`+` atau `−`); positif berarti A lebih lambat.
- Simpan WAV asli, file analisis, dan catatan; jangan menimpa rekaman.
- Sebutkan satuannya di laporan: ms, detik, cm, BPM.

### 6.2 CSV cold start

```csv
run_id,timestamp,device,install_mode,network,force_stop,airplane_verified,first_shell_s,standalone,screen,sw_build,precache_warning,offline_action,status,notes
```

### 6.3 CSV iOS storage

```csv
run_id,timestamp,device,ios_version,scenario,force_quit_or_reboot,wait,network_off,shell_offline,sw_build,session_marker,precache_bar,status,notes
```

### 6.4 CSV offset

```csv
run_id,timestamp,geometry,phone,segment,n_used,n_discarded,median_residual_ms,mad_ms,p_nominal_ms,p_ukur_ms,delta_ms,status,notes
```

Contoh **format** saja (angka fiktif, bukan hasil pengukuran):

```text
G1: median_A=12.4 ms, median_B=7.1 ms -> Δ=+5.3 ms
G2: median_A=11.8 ms, median_B=6.9 ms -> Δ=+4.9 ms
Selisih G1/G2=0.4 ms; status data=SAH; keputusan=LULUS (Δ ≤ 10 ms)
```

### 6.5 Bukti dan nama file

Simpan di folder bukti, misalnya:

```text
bukti/2026-11-21/run-01/
  F-20261121-01-identitas.md
  F-20261121-01-coldstart.md
  F-20261121-01-ios.md
  F-20261121-01-G1.wav
  F-20261121-01-G2.wav
  F-20261121-01-offset.csv
  F-20261121-01-catatan.md
```

Catat checksum SHA-256 WAV bila alatnya tersedia. Jangan mengirim rekaman berisi suara pribadi
ke tempat publik tanpa izin.

## 7. Ringkasan keputusan

Isi satu lembar setelah semua run selesai.

| Uji | Run yang dipakai | Hasil angka | Status | Catatan |
|---|---|---|---|---|
| Android cold start offline |  |  | LULUS/GAGAL/TIDAK SAH |  |
| iOS cold start offline |  |  | LULUS/GAGAL/TIDAK SAH |  |
| iOS storage S1 |  |  | PERSISTEN/SEBAGIAN/HILANG/TIDAK SAH |  |
| iOS storage S2 |  |  | PERSISTEN/SEBAGIAN/HILANG/TIDAK SAH |  |
| Offset G1/G2 |  | Δ =  | LULUS/GAGAL/TIDAK SAH |  |

## 8. Checklist sebelum meninggalkan ruangan

- [ ] Origin HTTPS, bukan localhost; ikon terpasang di kedua HP.
- [ ] Kedua HP memakai build/SW yang sama; tidak ada update yang menunggu.
- [ ] Tidak ada bar “Precache tidak lengkap” sebelum uji offline.
- [ ] Cold start benar-benar force-stop, bukan sekadar background.
- [ ] Mode pesawat aktif; Wi‑Fi, seluler, Bluetooth, VPN sudah diperiksa.
- [ ] Tiga run cold start offline tercatat, termasuk kegagalan.
- [ ] Skenario iOS S1/S2 dijalankan; S3/S4 dicatat bila dilakukan.
- [ ] Satu tab/aplikasi per HP saat pengukuran; tidak ada peringatan tab duplikat.
- [ ] Satu BPM tetap, tanpa ramp/setlist/hitungan masuk selama take.
- [ ] G1 dan G2 direkam sebagai take kontinu; WAV asli tersimpan.
- [ ] Tabel A/B/C terisi atau diberi `TIDAK SAH`.
- [ ] Tidak ada angka absolut dari satu mikrofon.
- [ ] Jaringan dinyalakan kembali; aplikasi tidak ditinggal di mode pesawat.

## 9. Batas yang harus ditulis di laporan

1. Ini protokol dua HP, bukan bukti untuk dua belas HP atau seluruh band.
2. Cold start offline hanya membuktikan shell; grid/sesi tidak dipersistenkan dan tidak diharapkan
   pulih tanpa server.
3. Storage iOS dapat berubah karena kebijakan OS, tekanan storage, atau reset pengguna. Protokol
   mencatat kondisi, bukan menjamin storage permanen.
4. Satu mikrofon hanya mengukur Δ relatif; latency absolut tidak diukur tanpa loopback.
5. Angka dari preview lokal bukan angka lapangan. Hanya origin HTTPS terpasang dan HP asli yang
   boleh mengisi tabel hasil.
