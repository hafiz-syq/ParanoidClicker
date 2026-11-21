# Rencana M6 — ParanoidClick: kalibrasi akustik

**Tanggal**: 2026-11-20
**Status**: **IRISAN 1 DIKERJAKAN (20 Nov 2026)** — estimator murni `src/app/audio/calibrate.ts`
ada beserta 6 tes sintetis. UI pengukuran, mikrofon, dan angka perangkat **belum** disentuh; §4
K1–K3 masih harus dijawab sebelum irisan 2.
**Basis**: tree setelah M3b/M4/M5 dan sesudah dua perbaikan 20 Nov (ramp berhenti saat lagu dipilih;
hitungan menyebut judul lagu aktif).
**Dasar**: README §"M2: servo θ …" menutup dengan "kompensasi latensi baru `baseLatency +
outputLatency` … buta terhadap delay TWS/Bluetooth → kalibrasi akustik M6".

## 1. Apa yang sudah ada

- `src/screens/DebugScope.tsx` punya tombol **Ukur audio** (`probeAudio`), tetapi ia hanya membaca
  `baseLatency`, `outputLatency`, sample rate, dan label mikrofon. Tidak ada bunyi yang diputar,
  tidak ada onset yang dideteksi, tidak ada angka latensi akustik.
- `ClickEngine.setLatencyComp(ms)` sudah menerima angka manual dari layar klik.
- `?layar=ukur` sudah menjadi tempat pengukuran lapangan (60 ping, θ, jitter), jadi ia tempat yang
  wajar untuk pengukuran akustik juga.

## 2. Yang belum, dan mengapa ini milestone sendiri

`baseLatency + outputLatency` tidak memuat delay perangkat keluaran (TWS/Bluetooth 100–300 ms) dan
tidak memuat jarak speaker–telinga. Angka yang salah membuat klik berbunyi *sesudah* ketukan yang
didengar band, dan itu terdengar sebagai "metronomnya telat" — bukan sebagai angka yang salah.

Kalibrasi akustik mengukur **lingkar penuh**: klik diputar di jam audio, mikrofon mendengar, selisih
waktu itu yang dipakai. Yang diukur karena itu bukan properti perangkat, melainkan properti rantai
audio HP itu pada saat itu.

## 3. Usul irisan pertama (belum izin)

1. **Fungsi murni** `src/app/audio/calibrate.ts`:
   `acousticLatency(pairs: {sentMs, heardMs}[]): { ms, used, rejected } | null` — median selisih,
   dengan pembuangan nilai di luar 0..500 ms dan di luar ±40 ms dari median (satu klik nyasar tidak
   boleh menggeser seluruh angka). Diuji tanpa mikrofon: masukan sintetis, outlier, daftar kosong.
2. **Pengukuran di `?layar=ukur`**: `probeAudio` memutar 8 klik pada jam audio, merekam mikrofon,
   mendeteksi onset pertama sesudah tiap klik, lalu menampilkan median + jumlah yang dipakai/dibuang.
   Mikrofon dan speaker wajib hidup; hasilnya **tidak** dipakai otomatis.
3. **Tidak menulis apa pun ke storage**: angka hanya tampil dan bisa disalin, seperti hasil ping.
   Pemakaian otomatis ke `setLatencyComp` adalah keputusan produk, bukan detail teknis.

## 4. Pertanyaan yang harus dijawab sebelum kode ([TANYA])

- **K1** — yang dikompensasi: latensi keluaran saja, atau lingkar penuh termasuk mikrofon? Mikrofon
  menambah delay masukan yang tidak dialami telinga, jadi memakai angka lingkar penuh sebagai
  kompensasi bisa **melebihkan** geseran.
- **K2** — apakah angka hasil ukur boleh dipakai otomatis, atau harus ditekan "Terapkan" dulu?
- **K3** — ambang pembuangan (0..500 ms, ±40 ms dari median) dan jumlah klik (8) adalah usul; kalau
  ada angka lapangan, angka itu yang menang.

## 5. Gerbang (tes merah dulu)

| # | Gerbang | Bentuk bukti |
|---|---|---|
| K1 | estimator mengembalikan median, bukan rata-rata, dan membuang outlier | **lulus** — `calibrate.spec.ts`: 5,5,6,7,300 → `{ ms: 6, used: 4, rejected: 1 }`; 10,10,10,60 → 10 (rata-rata akan 22,5) |
| K2 | daftar kosong / semua di luar rentang → `null`, bukan 0 | **lulus** — daftar kosong, `-1`/`901`, dan nilai non-finite semuanya `null`; `0` yang sungguhan tetap `{ ms: 0 }` |
| K3 | angka yang tampil di layar berasal dari fungsi yang sama dengan yang diuji | **belum** — UI pengukuran (irisan 2) memang belum ditulis |
| K4 | pengukuran di HP nyata: dua HP, speaker berbeda, angka dicatat | **belum** — tidak ada satu pun angka perangkat di ronde ini |
| K5 | `npm run check` EXIT=0, `npm run build` EXIT=0, angka dilaporkan mentah | **lulus** — `npm run check` EXIT=0 (117 + 6 unit, 39 worker); build di ronde sebelumnya EXIT=0 |

## 6. Yang TIDAK dikerjakan di M6

Tanpa profil per-merk headset, tanpa pengukuran otomatis berulang di latar, tanpa servis cloud, tanpa
deploy/push, dan tanpa perubahan protokol (`proto` tetap 2 — angka ini murni sisi klien).

## 7. Urutan yang disarankan

M6 butuh mikrofon + speaker + izin browser. Kalau perangkat itu tidak tersedia saat kode ditulis,
irisan yang jujur adalah **§3 butir 1 saja** (fungsi murni + tes), dan pengukurannya ditulis BELUM
di README sampai ada HP yang benar-benar mengukur. Itu lebih baik daripada menandai M6 selesai
berdasarkan angka `baseLatency`.
