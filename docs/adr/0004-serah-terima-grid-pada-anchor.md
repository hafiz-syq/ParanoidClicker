# ADR-0004: Grid baru diambil alih pada anchor-nya, bukan pada saat frame mendarat

**Tanggal**: 2026-11-15
**Status**: accepted
**Dasar perintah**: kontrak M2 butir 6 (sesi pemeriksa): "Kalau ramp mengubah bpm berangsur, itu
menyentuh `retune()` tiap bar — buktikan dengan test bahwa tidak ada satu pun beat yang terlewat
atau terdobel selama seluruh ramp, di kedua sisi jahitan."

## Konteks

Test kontinuitas ramp (ADR-0002) menemukan lubang, dan angkanya bukan nol: di tengah ramp
120 → 110, dua klik yang seharusnya berjarak 530,97 ms berjarak **1061,95 ms**. Yang tidak boleh
lolos adalah bahwa kedua penahan sudah ada di layar dan keduanya diam: `hilang` = 0 (beat itu belum
lewat pada saat adopsi) dan `tertelan` = 0 (yang dibuang bukan beat grid baru).

Sebabnya di aritmetika, bukan di timer. Frame `state` mendarat pada jam server `t`; antrean
oscillator hanya memegang beat sampai `t + LOOKAHEAD_MS + comp` (`schedule.ts:53`, ≈150 ms);
`retune` menaruh anchor di beat grid lama berikutnya sesudah `t + LEAD_MS` (`tempo.ts:54-57`,
`SessionDO.ts:171`) — jadi anchor bisa 2,3 detik di depan. Engine waktu itu mengganti grid
**sekarang juga**, sehingga beat grid lama di antara ekor antrean dan anchor — semuanya masih di
masa depan, semuanya akan berbunyi — tidak pernah disetel oleh siapa pun. Pada tombol ±5 BPM cacat
ini sudah ada sejak M1b; dia hanya jadi sistematis ketika ramp mengirim dua puluh jahitan.

## Keputusan

Engine menyimpan grid baru sebagai `pending` dan baru mengadopsinya pada tick pertama ketika
`serverNowMs >= anchorMs`. Predikatnya satu fungsi murni, `startsLater` (`schedule.ts:153`), dipakai
di dua tempat (`click.ts:129` saat frame mendarat, `click.ts:268` saat tick), sehingga model di test
dan engine di produksi menjawab pada aturan yang sama dan tidak bisa diam-diam berbeda.

Sampai anchor tiba, grid lama yang tetap menyetel beat — termasuk beat yang Waktunya persis sama
dengan anchor, karena `retune` menaruh anchor di latis lama. Pada saat serah terima itu cursor
dijaga aturan lama (ADR-0003): maju saja, tidak pernah mundur, jadi momen jahitan berbunyi **satu
kali** dari antrean grid lama, bukan dua kali.

## Alternatif yang dipertimbangkan

- **Setel sisa beat grid lama sekaligus, di saat adopsi** — tolak: scheduler harus memegang dua
  latis sekaligus dan semua angka `planBeats` (`schedule.ts:72`) ikut bercabang dua; `pending`
  hanya menambah satu field dan satu perbandingan.
- **Suruh `retune` mengambil beat berikutnya sesudah ekor antrean klien** — tolak: ekor antrean
  adalah keadaan tiap perangkat (θ, RTT, throttle berbeda), jadi anchor tidak lagi identik di
  dua belas HP. Itu melanggar "DO adalah jam" dan menuntut mengubah kontrak `state` di DO — hal
  yang secara eksplisit dilarang dibuka lagi tanpa pembicaraan dengan pemilik.
- **Biarkan lubangnya, laporkan sebagai `swallowed`** — tolak: operator mendapat angka sementara
  telinganya kehilangan satu klik utuh per bar, dan gerbang `0 hilang` tetap hijau. Angka yang
  melaporkan kerusakan bukan pengganti perbaikan.

## Konsekuensi

**Lebih mudah:** klaim "tidak ada beat terlewat di seluruh ramp" sekarang benar, bukan cuma
tidak terhitung; tombol ±tempo pemimpin ikut diperbaiki; tidak ada byte baru di jaringan, `proto`
tetap 2 (`index.ts:63`), klien lama tetap bisa masuk ruangan yang sama.
**Lebih sulit:** engine punya satu field keadaan lagi (`click.ts:86`). Frame yang datang belakangan
menggantikan `pending` yang masih antre — itu memang definisi "yang terbaru menang", tapi berarti
dua perubahan tempo dalam satu bar hanya menyisakan yang terakhir. `stop()` wajib ikut membuang
`pending`, kalau tidak frame yang sudah di jalan menyalakan klik setelah Stop.
**Risiko & penahan:** tab beku yang melewati anchor tidak mendapat serah terima tepat waktu; itu
jalur pemulihan yang sudah ada (adopsi dengan cursor maju-saja + `hilang` terhitung), dan test
"tab beku 3 detik lalu frame baru" tetap menuntut klik tidak ditumpuk sekaligus. Timer 25 ms adalah
satu-satunya pemicu serah terima, jadi pemimpin yang tab-nya dibekukan OS menunda jahitannya
sendiri — bunyinya tetap satu latis, hanya tertunda.

Test: `click.spec.ts` "frame yang datang sebelum anchor tidak memotong beat grid lama di antaranya"
(RED: jarak 1061,95 ms pada klik ke-31; GREEN: 1300/1800/2300/2800 berbunyi, 3300 sekali, `hilang`
dan `tertelan` nol) dan simulasi dua sisi di `ramp.spec.ts` yang mengimpor `startsLater` yang sama.
