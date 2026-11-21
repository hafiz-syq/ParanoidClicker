# ADR-0008 — Setlist adalah data di bawah `lk`, bukan kemampuan baru

**Status**: diterima (M3b, 20 Nov 2026)
**Konteks**: M3b menambah tabel `song` + `lagu_aktif` dan lima perintah tulis (`tambah`,
`hapus`, `naik`, `turun`, `pilih`).

## Keputusan

Setlist diperlakukan sebagai **data yang dikuasai kunci pemimpin**, bukan sebagai kemampuan
kedua dengan pagarnya sendiri:

1. Setiap perintah setlist lewat `assertLeader` yang sama dengan `tempo`/`start`/`stop` —
   dua syarat: `lkDibuktikan` di attachment socket DAN `leaderDid` yang cocok. Tidak ada
   model otoritas baru, dan tidak ada perintah yang membawa `lk`/`did` di frame-nya.
2. Balasannya adalah frame `state` yang sudah ada (ditambah `setlist` + `laguAktif`).
   Tidak ada frame baru, `proto` tetap 2.
3. Memilih lagu **memakai jalur `retune()` yang sama** dengan perintah `tempo`, bukan
   menghitung jahitannya sendiri. Satu jalur tempo, satu perilaku jahitan.
4. Batas angka hidup di `src/shared/setlist.ts` dan dipakai server maupun layar, supaya
   tombol yang mati dan penolakan server tidak pernah berbeda angka.

## Konsekuensi

- Anggota biasa melihat daftar yang sama dan tidak bisa mengubahnya. "Anggota boleh menambah
  lagu" bukan fitur kecil: itu membuka jalur tulis baru bagi kemampuan yang hari ini dikunci
  satu kunci, jadi ia butuh keputusan sendiri, bukan tambahan di sini.
- Setlist bertahan di SQLite ruangan, jadi DO yang tidur lalu bangun tidak melupakan lagu yang
  sudah disusun (`evictDurableObject` diuji di `src/worker/setlist.spec.ts`).
- Daftar ikut di setiap siaran `state`, termasuk pada setiap perubahan tempo: 1.496 byte untuk
  20 lagu berjudul penuh, kedalaman JSON tepat 4 (batas `MAX_JSON_DEPTH`). Menambah satu
  tingkat sarang di frame ini akan ditolak `checkShape`.
- Memilih lagu saat grid berjalan memindahkan tempo seluruh ruangan seketika, lewat jahitan
  awal bar. Itu konsekuensi yang diterima, bukan efek samping yang tersembunyi.
