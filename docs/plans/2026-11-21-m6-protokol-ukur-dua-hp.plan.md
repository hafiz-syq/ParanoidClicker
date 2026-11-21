# M6 — protokol pengukuran offset akustik di dua HP nyata

**Tanggal**: 21 November 2026
**Status**: **PROTOKOL SAJA**. Belum ada pengukuran, belum ada angka hasil, dan tidak ada
perubahan UI/kode. Semua sel hasil di bawah sengaja kosong.
**Tujuan**: mengukur offset akustik antara dua HP yang memainkan grid yang sama, memakai **satu
mikrofon pengukur**, dengan cara yang bisa diulang dan diputuskan lulus/gagal sebelum data
dikumpulkan.

## 0. Apa yang diukur, dan apa yang tidak

Protokol utama mengukur **Δ(A−B)**: selisih waktu tiba klik HP A dan HP B pada mikrofon yang sama,
dalam satu sesi dan satu grid. Nilai positif berarti klik A tiba lebih lambat. Ini adalah angka
yang langsung terasa sebagai flam; delay mikrofon, recorder, dan jarak akustik yang sama untuk
kedua HP saling menghapus.

Satu mikrofon **tidak** bisa memisahkan latency keluaran HP dari delay mikrofon/recorder tanpa
saluran referensi. Karena itu:

- **Jangan** menulis `acousticLatency` absolut dari metode satu mikrofon ini.
- `baseLatency`/`outputLatency` dari `?layar=ukur` hanya dicatat sebagai diagnosis, bukan kebenaran
  akustik dan bukan pengganti pengukuran.
- Pengukuran absolut hanya boleh diisi bila tersedia **loopback listrik** (satu mikrofon tetap satu;
  saluran line dari output HP bukan mikrofon kedua). Tanpa loopback, tulis
  `absolut: tidak diukur`, bukan menebak.

Pertanyaan M6 K1 (kompensasi keluaran saja atau lingkar penuh) tidak dijawab oleh protokol ini.
Protokol ini hanya menghasilkan Δ relatif yang bisa dipakai sebagai pemeriksaan silang.

## 1. Persiapan

### 1.1 Build dan sesi

1. Catat commit/build hash dan versi cache SW di kedua HP. Keduanya harus build yang sama.
2. Pastikan tidak ada banner **“Versi baru sudah siap”** atau SW `waiting` selama pengukuran.
   Kalau muncul, hentikan run dan ulangi setelah kedua HP memakai build yang sama; jangan
   mengaktifkan update di tengah pengukuran.
3. Buat sesi dari HP A (pemimpin), masukkan HP B sebagai pengikut. Catat `sid` dan waktu mulai.
4. Pakai satu BPM tetap, tanpa ramp, tanpa memilih lagu, tanpa hitungan masuk, dan tanpa perubahan
   tempo selama satu take. Catat BPM.
5. Tunggu sampai layar kedua HP menunjukkan `2 HP`, `jalan`, `ctx=running`, `0 hilang`, dan tidak
   ada re-anchor/`terputus` selama take.

### 1.2 HP

Untuk setiap HP, catat dan seragamkan:

- model, OS, browser, rute keluaran (speaker/earpiece/wired), level volume;
- Bluetooth/TWS **mati**; jangan memakai headset Bluetooth untuk pengukuran speaker;
- baterai cukup dan tidak sedang dicas (charger dapat menambah noise);
- notifikasi, alarm, getaran, dan suara sistem dimatikan;
- auto-lock dimatikan atau layar dijaga tetap hidup; wake lock/fallback audio dicatat;
- casing dilepas, port speaker tidak tertutup, orientasi HP sama;
- aplikasi audio lain ditutup; mode hemat baterai/adaptive battery dimatikan.

### 1.3 Mikrofon dan ruangan

1. Satu mikrofon pengukur pada stand, bukan mikrofon HP. Catat model dan (bila ada) file kalibrasi.
2. Recorder/interface mono, WAV PCM, 48 kHz/24-bit, tanpa kompresi, noise reduction, atau AGC.
   Atur gain sehingga klik tidak clipping; jangan mengubah gain di tengah take.
3. Letakkan mikrofon di tengah dua HP. Kedua speaker menghadap mikrofon, pada jarak yang sama;
   tandai posisi di meja/lantai. Catat jarak yang dipakai (simbol `d`, bukan hasil pengukuran).
4. Permukaan meja diberi kain/peredam; jauhkan dari dinding pemantul, kipas, AC, dan lalu lintas.
5. Lakukan uji 2–4 klik untuk memastikan level dan bahwa tidak ada suara ruangan yang lebih keras
   dari klik. Buang klik uji dari analisis.

### 1.4 Urutan posisi

Gunakan dua geometri:

- **G1**: HP A di kiri, HP B di kanan, mikrofon di tengah.
- **G2**: HP A dan B ditukar posisinya; mikrofon dan jarak tetap.

G2 membatalkan selisih jalur akustik yang tidak sengaja. Tanpa G2, perbedaan posisi bisa menyamar
sebagai offset HP.

## 2. Merekam offset dengan satu mikrofon

Metode ini memakai **satu mikrofon** dan **satu take kontinu** per geometri. Kedua HP tetap berada
di sesi dan grid yang sama; yang diubah hanya level keluaran, bukan start/stop atau tempo.

### 2.1 Urutan take

Untuk satu geometri:

1. Mulai recorder. Beri satu ketukan/clap penanda di awal (boleh dipakai untuk orientasi, bukan
   untuk perhitungan) lalu diam.
2. Pastikan kedua HP berbunyi. Set volume HP B ke nol; verifikasi B benar-benar senyap dan A
   berbunyi. Rekam **segmen A1: 8 ketukan**.
3. Set volume A ke nol, kembalikan B. Verifikasi hanya B yang berbunyi. Rekam **segmen B1: 8
   ketukan**.
4. Ulangi: A2 (8 ketukan), lalu B2 (8 ketukan), masih dalam take yang sama.
5. Hentikan recorder. Jangan memotong atau memindahkan file sebelum checksum/catatan dibuat.
6. Pindah ke G2 (tukar posisi HP), ulangi langkah 1–5. Jangan mengubah BPM, volume, atau gain.

Perubahan volume harus memakai tombol volume media, bukan silent switch. Matikan bunyi UI sistem
sebelumnya. Buang satu ketukan di sekitar setiap pergantian volume; bila pergantian menghasilkan
bunyi sendiri atau dua klik terdengar bersamaan, segmen itu tidak sah.

### 2.2 Analisis

1. Deteksi onset pertama setiap klik pada waveform/spectrogram, dengan ambang yang sama untuk
   semua segmen. Jangan memakai puncak absolut; gunakan onset.
2. Mulai indeks ketukan `n = 0` pada klik pertama yang sah. Karena satu ketukan hanya boleh
   memperdengarkan satu HP, indeks bertambah satu untuk setiap ketukan; segmen yang kehilangan atau
   mendapat klik ekstra dibuang.
3. Hitung `P_nominal = 60000 / BPM` (ms) dari BPM yang dicatat. Hitung juga `P_ukur` sebagai
   median interval antar ketukan berurutan yang dapat dideteksi; pakai `P_ukur` untuk residual.
   Catat selisih `P_ukur − P_nominal`; jangan mengubah BPM selama take.
4. Untuk setiap klik sah: `residual = t_tiba − n·P_ukur`. Untuk tiap HP, ambil **median** residual
   segmen-segmennya. Jangan memakai rata-rata.
5. `Δ = median_A − median_B`. Tulis tanda dan satuannya. G2 harus memberi tanda yang sama; bila
   tandanya berbalik, anggap geometri/ruangan tidak valid, bukan “offset nol”.
6. Periksa drift: bandingkan interval awal dan akhir take. Bila `P_ukur` berubah secara sistematis
   (bukan satu ketukan nyasar), take tidak sah; ulangi dengan sesi yang lebih pendek, jangan
   mengoreksi offset memakai asumsi drift.
6. Simpan WAV asli, file analisis, dan catatan; jangan menimpa rekaman.

Metode ini mengukur kedatangan akustik relatif. Ia tidak boleh dikonversi menjadi
`setLatencyComp` seolah-olah itu latency keluaran absolut.

### 2.3 Absolut (opsional, hanya dengan loopback)

Bila tersedia splitter output HP ke speaker dan ke line-in recorder:

1. Rekam kanal listrik (referensi `sentMs`) dan kanal mikrofon (onset `heardMs`) secara bersamaan.
2. Untuk tiap klik, isi pasangan `{sentMs, heardMs}` dan hitung dengan estimator M6 yang ada.
3. Catat `ms`, `used`, `rejected`; jangan memakai `baseLatency`/`outputLatency` sebagai pengganti.
4. Tanpa loopback, kolom absolut di tabel **dibiarkan kosong** dan diberi catatan
   `tidak diukur — satu mikrofon saja`.

## 3. Tabel angka yang harus diisi

Semua kolom hasil di bawah kosong. Isi hanya setelah take selesai dan file disimpan.

### Tabel A — per HP

| Bidang | HP A | HP B |
|---|---|---|
| Model / OS / browser |  |  |
| Build/SW hash |  |  |
| Peran (pemimpin/pengikut) |  |  |
| Rute keluaran / level volume |  |  |
| `baseLatency` (ms) dari `?layar=ukur` |  |  |
| `outputLatency` (ms) dari `?layar=ukur` |  |  |
| Posisi G1 / G2 |  |  |
| Jarak speaker–mic `d` (cm) |  |  |
| Segmen A1: dipakai / dibuang |  |  |
| Segmen A2: dipakai / dibuang |  |  |
| Segmen B1: dipakai / dibuang |  |  |
| Segmen B2: dipakai / dibuang |  |  |
| Median residual G1 (ms) |  |  |
| Median residual G2 (ms) |  |  |
| MAD residual G1 / G2 (ms) |  |  |
| Status data G1 / G2 |  |  |
| Absolut `acousticLatency.ms` (opsional) |  |  |
| Absolut `used` / `rejected` (opsional) |  |  |

### Tabel B — per geometri

| Geometri | Median A (ms) | Median B (ms) | Δ = A−B (ms) | Sebaran/ulangan (ms) | Sah? | Catatan |
|---|---:|---:|---:|---:|---|---|
| G1 — A kiri, B kanan |  |  |  |  |  |  |
| G2 — A kanan, B kiri |  |  |  |  |  |  |
| Gabungan G1/G2 |  |  |  |  |  |  |

### Tabel C — gerbang

| Gerbang | Ambang yang disepakati | G1 | G2 | Hasil |
|---|---|---|---|---|
| Cakupan segmen | ≥ 6 dari 8 klik sah per segmen |  |  |  |
| Outlier | ≤ 2 klik dibuang per segmen |  |  |  |
| Clipping/noise | tidak ada sample clipping; onset jelas |  |  |  |
| Ulangan geometri | \|ΔG1 − ΔG2\| ≤ 5 ms |  |  |  |
| Kestabilan onset | MAD residual tiap segmen ≤ 3 ms |  |  |  |
| Offset relatif | \|Δ gabungan\| ≤ 10 ms |  |  |  |
| Absolut (opsional) | `used ≥ 6`, `rejected ≤ 2`, non-null |  |  |  |

## 4. Ambang lulus/gagal

Angka di bagian ini adalah **kriteria protokol yang ditetapkan sebelum pengukuran**, bukan hasil
pengukuran dan bukan klaim tentang perangkat tertentu. Bila pemilik produk ingin ambang lain,
ubah dan catat sebelum mengambil data; jangan mengubahnya setelah melihat hasil.

### 4.1 Status data

Gunakan status berikut agar “gagal” tidak tercampur dengan “belum sah”:

- **SAH**: setiap segmen yang dipakai mempunyai ≥ 6 dari 8 klik; tidak ada clipping; onset tidak
  ambigu; MAD residual ≤ 3 ms; tidak ada update SW, tempo berubah, atau `hilang` selama take.
- **TIDAK SAH — ULANGI**: kurang dari 6 klik per segmen, clipping, onset bertumpuk, bunyi
  ruangan besar, \|ΔG1 − ΔG2\| > 5 ms, atau MAD residual > 3 ms. Jangan memakai angka dari run ini.
- **LULUS**: data SAH dan \|Δ gabungan\| ≤ 10 ms.
- **GAGAL**: data SAH tetapi \|Δ gabungan\| > 10 ms. Angka tetap dicatat; artinya offset relatif
  melewati ambang dan perlu kompensasi/investigasi, bukan bahwa pengukurannya tidak sah.

### 4.2 Aturan pemakaian

1. Jangan memilih hasil yang paling bagus. Laporkan semua run SAH/TIDAK SAH.
2. Jangan menghapus outlier yang bukan kegagalan onset; estimator/median sudah menangani satu
   nilai nyasar, tetapi alasan pembuangan harus ditulis.
3. Jangan mengisi sel absolut dari Δ relatif.
4. Jangan menerapkan angka apa pun ke `setLatencyComp` sebagai bagian dari protokol ini; keputusan
   K1/K2 masih terbuka.
5. Kalau kedua HP tidak dapat mencapai \|Δ\| ≤ 10 ms, protokol tetap menghasilkan **GAGAL** yang
   jujur; jangan menaikkan ambang setelah melihat angka.

## 5. Checklist sebelum meninggalkan ruangan

- [ ] Kedua HP memakai build/SW yang sama dan tidak ada banner update.
- [ ] BPM, rute keluaran, volume, jarak, dan posisi tercatat.
- [ ] Dua geometri direkam; urutan segmen A-B-A-B utuh dalam satu take per geometri.
- [ ] WAV asli, checksum, dan catatan tersimpan.
- [ ] Tabel A/B/C diisi atau diberi status TIDAK SAH.
- [ ] Tidak ada perubahan UI/kode dan tidak ada angka yang diklaim sebagai hasil sebelum diukur.
