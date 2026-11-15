import { expect, it } from 'vitest';
import { barisOutput, cekKutipanREADME } from './cr.mjs';
import { cekIkon } from './gerbang-ikon.mjs';

// Dua penjaga yang dulu hanya janji, sekarang bagian dari `npm run test` — dan karena itu
// dari `npm run check`. Alasannya konkret:
//  - README pernah memuat rentang CR (3,19-3,74) dan satu hex (#595965) yang tidak pernah
//    dicetak scripts/cr.mjs. Penjaga kutipannya ada, tapi tidak ada satu langkah pun yang
//    memanggilnya, jadi README boleh berisi angka karangan sambil check tetap hijau.
//  - Bug Marshal.Copy membuat paranoid-512.png ≡ paranoid-maskable-512.png byte-for-byte;
//    penjaga per-file (terang == 0) lulus untuk itu karena kedua file sama-sama punya
//    piksel terang. Yang menggigit hanya perbandingan sha256 antar-berkas.
// Pola "penjaga yang cuma diklaim" adalah persis yang dibereskan di commit 97aa004.

it('README tidak menyimpan satu pun baris CR yang tidak dihasilkan scripts/cr.mjs', () => {
  // 0,8 diketik eksplisit, bukan dibiarkan ikut default: kalau tidak, `COV=1 npm run test`
  // menghasilkan baris coverage yang berbeda dan penjaga ini bisa dibungkam lewat env.
  const keluar = barisOutput(0.8);
  const k = cekKutipanREADME(keluar);
  // Jumlah = 0 berarti blok kutipannya dihapus, dan itu harus TERGUNGKU, bukan dianggap lulus.
  expect(k.jumlah, 'README tidak mengutip satu baris pun output cr.mjs — penjaganya hilang, bukan lulus').toBeGreaterThan(0);
  expect(
    k.palsu.map(({ n, l }: { n: number; l: string }) => `README:${n} |${l}|`),
    'setiap baris CR di blok README harus verbatim di output cr.mjs pada tree ini'
  ).toEqual([]);
});

it('ikon web dan ikon aplikasi berbeda byte, sizes yang ditulis dokumen = IHDR sebenarnya, dan permukaan tidak bertukar keluarga', () => {
  const g = cekIkon();
  expect(g.gagal, 'ikon: kembar / sizes bohong / rujukan manifest+index.html hilang').toEqual([]);
  const h = (nama: string) => g.berkas.get(nama)?.hash as string | undefined;
  expect(h('ikon/paranoid-512.png'), 'paranoid-512.png tidak ada di public/ikon').toBeTruthy();
  expect(h('ikon/paranoid-maskable-512.png'), 'paranoid-maskable-512.png tidak ada di public/ikon').toBeTruthy();
  expect(h('ikon/paranoid-maskable-512.png'), 'maskable ≡ 512 biasa: komposit mark terbuang, bug Marshal.Copy kembali').not.toBe(
    h('ikon/paranoid-512.png')
  );
});
