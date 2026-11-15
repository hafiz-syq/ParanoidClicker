# ADR-0003: `adoptIndex` melaporkan beat yang tertelan di jahitan

**Tanggal**: 2026-11-15
**Status**: accepted
**Dasar perintah**: kontrak M2 butir 4: "Bayarkan `adoptIndex` yang sudah dijanjikan … Servo punya
angka antrean, jadi ganti patokan itu." Butir 5: invarian cursor — boleh melompat MAJU, tidak
pernah mundur (`schedule.ts:110-113`).

## Konteks

Baris di bagian ini mengacu ke `schedule.ts` **sebelum** M2 (`HEAD` saat ADR ini ditulis); angka
setelah keputusan mengacu ke berkas sekarang.

`adoptIndex` (`schedule.ts:123`) adalah tempat engine melanjutkan diri saat grid berganti di tengah
lagu. Patokannya waktu beat terakhir yang sudah disetel (`beatMs(from, fromIndex - 1)`), dan
`shortcut:` di `schedule.ts:119-121` mengakui harga yang dibayar: beat grid baru yang jatuh di
dalam sisa antrean grid lama **dibuang**, dan `abandonedBeats` (`schedule.ts:134`) — yang mengukur
dari `serverNow` — tidak pernah menghitungnya. Akibatnya `hilang` bisa kurang satu klik per
jahitan: persis keterbatasan yang masih tertulis di README M1b.

## Keputusan

`adoptIndex` (`schedule.ts:128`) mengembalikan `{ index, swallowed }`. `index` adalah cursor baru —
patokannya tetap **ekor antrean oscillator** (`beatMs(from, fromIndex - 1)`), dan boleh melompat
maju tapi tidak pernah mundur. `swallowed` dihitung dari **momen**, bukan dari selisih indeks: dari
beat grid baru yang masih bisa berbunyi saat frame ini mendarat sampai cursor baru, yang dihitung
hanya beat yang momennya TIDAK jatuh di latis grid lama (±1 ms). Alasannya, dan ini yang pertama
kali kelihatan saat gerbang ramp dibuka:

- beat grid baru yang persis sama waktunya dengan beat grid lama **sudah berbunyi** dari antrean
  lama — itulah jahitan `retune`, dan menyebutnya "tertelan" akan menagih klik yang tidak bolong;
- beat dengan indeks negatif bukan bagian dari perubahan tempo ini — sebelum anchor, latis baru
  hanya mendeskripsikan waktu yang masih milik grid lama, dan menghitungnya membuat setiap
  `retune` normal melaporkan tiga sampai empat "kehilangan" palsu;
- beat yang jauh di belakang `serverNow` sudah jadi lubang sebelum frame ini lahir; itu wilayah
  `abandonedBeats` (`schedule.ts:163`) dan dihitung di sana, sekali saja.

Engine menampilkannya sebagai stat sendiri (`jahitan` di `click.ts:141`), **tidak** digabung ke
`hilang`. Invarian maju-saja tidak disentuh: test menuntut indeks yang dibunyikan selalu naik
selama servo, ramp, dan reconnect bekerja.

## Alternatif yang dipertimbangkan

- **Batalkan oscillator di antrean lalu setel ulang dari grid baru** — tolak: `onended` dari osc
  yang dibatalkan harus diberi flag "tidak jadi berbunyi", probe `meleset` jadi mengukur klik yang
  tidak pernah ada di udara, dan lubang yang dibeli cuma ≤ 120 ms (`LOOKAHEAD_MS`,
  `schedule.ts:53`).
- **Gabungkan `swallowed` ke `missed`** — tolak: pada jahitan `retune`, beat grid baru yang tertelan
  **sudah berbunyi** dari antrean grid lama di momen yang sama persis — identitas itu sudah punya
  test-nya sendiri (`schedule.spec.ts:263` "jahitan yang dilewati antrean grid lama bukan klik
  hilang"). Digabung ke `hilang` membuat gerbang `0 hilang` berteriak saat tidak ada yang bolong,
  dan melatih operator mengabaikan angka yang benar.
- **Biarkan `shortcut:` seperti sekarang** — tolak: janjinya jatuh tempo di M2, dan servo membuat
  engine benar-benar tahu keadaan antreannya, jadi tidak ada alasan tersisa untuk tidak melapor.

## Konsekuensi

**Lebih mudah:** setiap jahitan tempo, join, dan reconnect sekarang menghasilkan angka; ramp
(ADR-0002) bisa dituntut `swallowed = 0` di *seluruh* 20 bar, dan klaim itu bisa diuji, bukan
dibacakan. **Lebih sulit:** satu nilai balik yang tadinya angka tunggal sekarang struct — semua pemanggil
(`click.ts:117`) dan tiga test `adoptIndex` ikut berubah, dan itu disengaja
supaya tidak ada pemanggil yang lolos tanpa memikirkan lubang jahitan.
**Risiko & penahan:** `swallowed` > 0 berarti ada beat grid baru yang dibuang pada momen yang tidak
dipunyai grid lama — bunyi di momen itu benar-benar bolong. Pada jalur normal itu tidak terjadi,
karena frame tidak lagi diadopsi saat mendarat melainkan saat anchor-nya tiba (ADR-0004). Yang
meninggalkannya adalah frame yang mendarat setelah anchor — tab beku, atau `LEAD_MS` yang habis —
dan itu muncul di layar sebagai angka, bukan sebagai komentar di source.
