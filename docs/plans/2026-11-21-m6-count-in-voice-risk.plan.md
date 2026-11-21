# M6/M5 — risiko hitungan masuk `speechSynthesis`, dan usulan penggantinya

**Tanggal**: 21 November 2026
**Status**: **DIIMPLEMENTASIKAN (Opsi A)**. Beep AudioContext menggantikan `speechSynthesis`;
bagian 1–2 di bawah adalah catatan perilaku **sebelum** perubahan dan disimpan sebagai dasar
keputusan. Pengukuran jadwal ada di `src/app/audio/click.spec.ts`.
**Basis**: `src/app/audio/voice.ts`, `src/app/audio/voice.spec.ts`, `hitungMasuk()` di
`src/screens/ClickRoom.tsx`, dan `ClickEngine` di `src/app/audio/click.ts`.

## 1. Perilaku sekarang

`countInPlan()` sudah benar secara aritmetika: ia memilih downbeat berikutnya dan menempatkan
`Intro` + `one/two/three/four` tepat satu periode grid. Masalahnya ada pada eksekusi:

- `hitungMasuk()` menjadwalkan `speak(text)` dengan `window.setTimeout` berdasarkan jam dinding,
  bukan jam audio.
- `speak()` memakai `speechSynthesis`, `lang = 'en-US'`, `rate = 1.05`, tanpa memilih voice dan
  tanpa menangani `onstart`, `onerror`, atau kegagalan jaringan.
- `speechAvailable()` hanya memeriksa keberadaan API, bukan apakah ada voice yang bisa dipakai.
- Tombol hitungan masuk hanya dirender untuk pemimpin, jadi saat ini hanya satu HP yang
  mengucapkan. Itu membatasi masalah echo, tetapi tidak menghilangkan masalah waktu/voice.

Klik biasa tetap dijadwalkan oleh `ClickEngine` di jam audio. Hitungan masuk karena itu bisa
terlambat atau tidak terdengar sementara kliknya tetap tepat.

## 2. Risiko

### R1 — Sebagian voice Android membutuhkan jaringan (risiko utama)

Android mengekspos `Voice.isNetworkConnectionRequired()`; voice dengan nilai itu membutuhkan
koneksi. Web Speech API juga membedakan voice lokal dan remote lewat `localService`, dan
mendefinisikan error `network`, `synthesis-unavailable`, dan `language-unavailable`. Di Chrome
Android, voice yang tersedia bergantung pada engine TTS yang dipilih, bahasa/region perangkat,
dan data voice yang sudah diunduh.

Akibatnya:

- `speechAvailable()` bisa `true` tetapi `speak()` tidak menghasilkan suara, atau baru berbunyi
  setelah jaringan tersedia.
- Di ruang latihan tanpa internet, hitungan masuk bisa hilang tanpa error yang terlihat karena
  `speak()` mengembalikan `true` hanya berarti utterance diterima, bukan sudah diucapkan.
- Dua HP bisa memiliki daftar voice berbeda; kalau hitungan pernah dijalankan di lebih dari satu
  HP, bunyinya tidak seragam.

Rujukan: [Android `Voice`](https://developer.android.com/reference/android/speech/tts/Voice),
[W3C Web Speech API](https://w3c.github.io/speech-api),
[Readium speech notes](https://readium.org/speech/docs/WebSpeech.html),
[Chrome community: voice data Android](https://support.google.com/chrome/thread/223114613/how-does-chrome-on-android-load-new-voices-for-the-speech-synthesis-api?hl=en).

### R2 — Waktu mulai dan durasi tidak bisa dijadwalkan sample-accurate

`setTimeout` hanya menitipkan niat; `speechSynthesis` menentukan kapan utterance benar-benar
mulai. Latensi voice bisa berbeda jauh antar perangkat/voice, dan laporan lapangan mencatat
kasus voice Android yang baru berbunyi jauh setelah diminta. Tidak ada cara menjamin kata
pertama jatuh tepat di downbeat.

Klik tetap menjadi patokan, tetapi hitungan yang terlambat justru menyesatkan: band mendengar
angka setelah ketukan yang seharusnya. Ini juga tidak bisa diperbaiki dengan mengubah `rate`
secara global karena tiap voice punya tempo ucapan sendiri.

### R3 — Voice, bahasa, dan pengucapan berbeda antar HP

`lang = 'en-US'` hardcoded. HP tanpa voice en-US dapat memakai fallback yang tidak jelas,
mengucapkan kata dengan aksen berbeda, atau menolak utterance. Voice default iOS/Android dan
paket bahasa OEM tidak seragam. Kalau hitungan hanya di pemimpin, perbedaan antar HP baru
terasa saat pemimpin berganti atau saat fitur dijalankan di lebih dari satu HP.

### R4 — Antrean dan pembatalan tidak lengkap

`hitungMasuk()` membatalkan timer `setTimeout` lama, tetapi **tidak** memanggil
`speechSynthesis.cancel()`. Utterance yang sudah masuk antrean/sedang diucapkan dapat terus
berbunyi saat pengguna menekan hitungan lagi. Itu bisa menghasilkan dua hitungan bertumpuk
atau kata dari jadwal lama setelah jadwal baru dimulai.

`speak()` juga tidak memasang `onerror`/`onend`, sehingga kegagalan voice atau antrean tidak
pernah terlihat di layar diagnostik.

### R5 — Tab latar, webview, dan gestur

Timer jam dinding dan `speechSynthesis` dapat ditunda/di-pause saat tab disembunyikan. Beberapa
webview Android tidak menyediakan API ini; iOS mensyaratkan interaksi pengguna sebelum speech
pertama. Tombol memang gestur, tetapi utterance yang dijadwalkan beberapa detik kemudian tidak
selalu menikmati jaminan yang sama.

### R6 — Kualitas dan privasi

Voice online dapat mengirim teks ke layanan TTS. Untuk “Intro/one/two” risikonya kecil, tetapi
tetap merupakan ketergantungan eksternal yang tidak diperlukan untuk menjaga tempo.

## 3. Kebutuhan pengganti

Pengganti harus:

1. Dijadwalkan di **jam audio**, bukan `setTimeout`.
2. Tidak membutuhkan jaringan setelah aset awal tersedia.
3. Tidak bergantung pada voice/engine perangkat.
4. Memberi pola yang dapat dibedakan dari klik biasa.
5. Tetap bekerja saat `speechSynthesis` tidak ada, offline, atau tab kembali dari latar.
6. Tidak menambah ketergantungan baru pada server; hitungan tetap bagian dari sesi lokal.

## 4. Opsi

### Opsi A — Beep terjadwal (rekomendasi utama)

Pakai `AudioContext` yang sudah dipakai `ClickEngine`. Untuk setiap `atMs` dari `countInPlan()`,
jadwalkan osilator/gain pendek pada jam audio, dengan pola yang berbeda dari klik biasa
(misalnya nada lebih tinggi/lebih panjang untuk awal, lalu empat beep; atau dua nada untuk
downbeat). Konversi waktu memakai bridge/θ/kompensasi yang sama dengan klik.

**Kelebihan**: tidak ada network/voice, sample-accurate, deterministik, kode kecil, aset nol,
tidak ada perbedaan antar HP, tetap bekerja offline. **Kekurangan**: tidak mengucapkan
“one/two”; band harus belajar pola bunyi. Dampaknya bisa dikurangi dengan label visual
“Intro 1 2 3 4” di layar dan pola nada yang jelas.

**Risiko yang perlu dijaga**: beep jangan tertukar dengan klik biasa; volume/pola harus
konsisten; hitungan tidak boleh menggandakan klik di beat yang sama.

### Opsi B — Sampel yang di-precache

Sediakan satu set sampel pendek (`intro`, `one`, `two`, `three`, `four`) dalam format audio
kecil, masukkan ke precache service worker, decode sekali dengan `AudioBufferSourceNode`, lalu
jadwalkan di jam audio. Sampel yang sama dipakai semua HP yang memutar hitungan.

**Kelebihan**: tetap terdengar seperti hitungan verbal, konsisten lintas HP, tidak butuh TTS
atau jaringan saat sesi. **Kekurangan**: ukuran aset dan versi cache baru; `decodeAudioData`
pertama bisa menambah jeda; lisensi/voice sampel; perlu fallback bila decode gagal. Ini lebih
layak jika “one/two/three/four” verbal adalah kebutuhan produk, bukan sekadar penanda masuk.

### Opsi C — Hybrid

Beep sebagai fallback yang selalu tersedia; sampel dipakai bila sudah termuat. Ini paling
tahan banting tetapi menambah dua jalur dan lebih sulit diuji. Tidak disarankan untuk irisan
pertama.

**Rekomendasi**: **Opsi A lebih dulu**. Beep terjadwal menyelesaikan risiko jaringan, voice,
dan timing dengan perubahan paling kecil. Opsi B dipertimbangkan hanya jika hasil wawancara/
pemakaian menunjukkan hitungan verbal penting.

Catatan desain Opsi A: jangan memakai `setTimeout` sama sekali untuk bunyi; hitung `atMs` dari
`countInPlan()`, ubah ke waktu audio dengan bridge/θ/kompensasi yang sama seperti klik, lalu
jadwalkan osilator. Label teks di layar tetap boleh ada, tetapi suara tidak menunggu TTS.

## 5. Bukti kecil yang bisa dijalankan lokal

Jangan menambah UI produksi. Bukti ini berupa halaman probe statis terpisah (nanti diletakkan
di `bukti/`, bukan dirender aplikasi) atau console snippet yang dijalankan manual di dua HP.

### Probe 1 — inventaris voice

Di tiap HP, catat:

- `speechSynthesis` dan `SpeechSynthesisUtterance` ada/tidak;
- `getVoices()` kosong saat awal dan setelah `voiceschanged`;
- untuk voice `en-US`/`id-ID`: `localService`, `default`, `lang`, nama;
- hasil dengan internet mati dan hidup.

Tabel:

| HP | online/offline | API ada | jumlah voice | voice en-US lokal? | voice id-ID? | catatan |
|---|---|---|---|---|---|---|
| A |  |  |  |  |  |  |
| B |  |  |  |  |  |  |

### Probe 2 — waktu mulai speech vs jadwal

Probe menjadwalkan empat `speak()` berturut-turut pada jarak satu beat (mis. 500 ms) dan
mencatat `performance.now()` saat dipanggil, `onstart`, `onend`, dan `onerror`. Ulangi dengan:

- voice default dan voice yang dipilih eksplisit;
- online dan offline;
- tab terlihat dan tab disembunyikan;
- dua kali tekan berturut-turut (untuk melihat antrean).

Tabel:

| HP | kondisi | jadwal kata (ms) | mulai aktual (ms) | selisih (ms) | error/end | terdengar? |
|---|---|---:|---:|---:|---|---|
| A | online |  |  |  |  |  |
| B | offline |  |  |  |  |  |

Probe ini tidak perlu mengubah app; cukup halaman statis dengan tombol dan log. Snippet
console minimal (tempel di console HP, bukan ke app):

```js
(() => {
  const log = (...a) => console.log('[hitung-probe]', ...a);
  const voices = () => speechSynthesis.getVoices().map(v => ({
    name: v.name, lang: v.lang, local: v.localService, def: v.default,
  }));
  log('awal', voices());
  speechSynthesis.addEventListener('voiceschanged', () => log('voiceschanged', voices()), { once: true });

  const base = performance.now();
  ['one', 'two', 'three', 'four'].forEach((text, i) => {
    const target = base + i * 500;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.05;
    u.onstart = () => log(text, 'start', Math.round(performance.now() - base), 'target', i * 500);
    u.onend = () => log(text, 'end', Math.round(performance.now() - base));
    u.onerror = (e) => log(text, 'error', e.error);
    setTimeout(() => speechSynthesis.speak(u), Math.max(0, target - performance.now()));
  });
})();
```

Catat juga bahwa `speak()` tidak menunggu `onstart`; angka `target` dan `start` di log adalah
bukti selisih yang dicari. Ulangi setelah `speechSynthesis.cancel()` untuk melihat efek antrean.

### Probe 3 — beep terjadwal

Di halaman yang sama, jadwalkan empat beep osilator pada `AudioContext.currentTime` yang
dikonversi dari jadwal yang sama. Catat waktu `onended`/rekam dengan satu mikrofon. Bandingkan
selisih jadwal vs onset. Tabel:

| HP | jadwal beep (ms) | onset rekaman (ms) | selisih (ms) | catatan |
|---|---:|---:|---:|---|
| A |  |  |  |  |
| B |  |  |  |  |

### Probe 4 — sampel (hanya jika Opsi B dipertimbangkan)

Precache satu set sampel, decode, jadwalkan dengan `AudioBufferSourceNode`, lalu ulangi Probe 3
dengan internet mati dan cache kosong/terisi. Catat waktu decode pertama dan apakah fallback
bekerja.

### Bukti awal di mesin ini

Di preview desktop, API dan voice tersedia (`Microsoft David`, `Microsoft Zira`, `Microsoft
Andika`; semuanya `localService: true`). Ini **hanya sanity check desktop** dan tidak
membuktikan HP Android: tidak ada pengukuran voice online/offline atau latensi Android di sini.
Angka hasil probe di atas masih kosong.

## 6. Gerbang keputusan sebelum implementasi

1. Apakah hitungan verbal wajib? Jika tidak, setujui Opsi A dan jangan tambah aset audio.
2. Jika verbal wajib, setujui Opsi B beserta batas ukuran aset, lisensi sampel, dan strategi
   cache/version.
3. Tetapkan pola beep dan volume sebelum coding; jangan mengubah pola setelah mendengar hasil.
4. Probe 1–3 harus dijalankan minimal di dua HP Android nyata dan satu kondisi offline sebelum
   pengganti dianggap siap.
5. Tidak ada perubahan UI pada tahap probe; halaman probe terpisah dan tidak dikirim ke produksi.

## 7. Yang tidak dikerjakan

Belum ada perubahan pada `voice.ts`, `ClickRoom.tsx`, service worker, atau UI. Belum ada
pemilihan voice, `cancel()`, sample, maupun beep baru. Dokumen ini hanya investigasi dan usulan
untuk disetujui.
