// Hitung contrast ratio (CR) WCAG untuk pasangan warna yang dipakai layar.
// Rumus: WCAG 2.2 definisi contrast ratio (relative luminance, koefisien 0.2126/0.7152/0.0722).
// Dipakai sebagai gerbang bukti A1: angka ini yang dilaporkan, bukan kata "sudah kontras".
//
// File ini DIPAKAI DUA KALI oleh jalur yang berbeda, dan itu sengaja:
//   - `node scripts/cr.mjs`          -> mencetak + memeriksa (perintah manual, dan penjaga lama)
//   - src/... /scripts/gerbang.spec.ts -> mengimpor barisOutput()/cekKutipanREADME() tanpa
//     mencetak apa pun, supaya pemeriksaan itu ikut jalan di `npm run test` dan karena itu di
//     `npm run check`. Penjaga yang hanya menggigit kalau orang ingat mengetik perintahnya
//     persis pola yang dibereskan di commit 97aa004 — jadi dia sekarang bagian dari tes.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const L = (hex) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? [...h].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const [r, g, b] = f.map((x) => parseInt(x, 16) / 255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const cr = (a, b) => {
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// --- batas dengan PENYIMPANGAN render yang terukur di browser bukti ---
// Di Chromium tempat screenshot diambil, border 1px punya lebar computed 0,8px: piksel
// yang digambar = 0,8*warna + 0,2*warna di belakangnya (terbukti: #808088 di atas
// #0b0b0f keluar sebagai rgb(89,89,101)). Jadi yang harus lolos 3:1 adalah warna
// HASIL CAMPURAN itu, bukan warna yang ditulis di CSS.
export const blend = (fg, bg, cov) => {
  const h = (x) => x.replace('#', '').match(/../g).map((v) => parseInt(v, 16));
  const [a, b] = [h(fg), h(bg)];
  return '#' + a.map((v, i) => Math.round(cov * v + (1 - cov) * b[i]).toString(16).padStart(2, '0')).join('');
};

const PAIRS = [
  ['#eee', '#0b0b0f', 'teks layar di atas latar global'],
  ['#9cf', '#0b0b0f', 'tautan'],
  ['#f99', '#0b0b0f', 'peringatan (badLink)'],
  ['#8f8', '#0b0b0f', 'status ok'],
  ['#f88', '#0b0b0f', 'status basi'],
  ['#eee', '#1b1b22', 'label tombol'],
  ['#9a9ab0', '#16161c', 'label tombol disabled (vs bg disabled)'],
  ['#8f8', '#101016', 'teks pre/textarea di atas panel'],
  ['#8f8', '#0f0f14', 'angka di dalam field input'],
  ['#808088', '#0b0b0f', 'border komponen vs latar halaman'],
  ['#808088', '#1b1b22', 'border tombol vs isi tombol'],
  ['#808088', '#0f0f14', 'border field vs isi field'],
  ['#808088', '#101016', 'border panel vs isi panel'],
];
const CALON_BORDER = ['#444444', '#555555', '#5e5e5e', '#636363', '#808088', '#707070'];
const CALON_DISABLED = ['#8a8a96', '#909098', '#9a9ab0', '#a0a0a8'];
const CALON_TERANG = ['#6b6b78', '#75757f', '#7a7a85', '#808088'];

// Semua baris yang "dicetak" dibangun di sini TANPA console.log, supaya spec bisa memakainya
// sebagai sumber kebenaran dan CLI tinggal menuliskannya keluar.
export const barisOutput = (cov = Number(process.env.COV ?? 0.8)) => {
  const k = [];
  for (const [fg, bg, what] of PAIRS) {
    const v = cr(fg, bg);
    const teks = v >= 4.5 ? 'AA teks' : v >= 3 ? 'hanya non-teks' : 'GAGAL';
    k.push(`${fg} di ${bg} = ${v.toFixed(2)}:1  [${teks}]  ${what}`);
  }
  k.push('', 'latar LAMA #ffffff (sebelum global.css ada):');
  for (const [fg, what] of [['#9cf', 'tautan lama'], ['#f99', 'peringatan lama'], ['#eee', 'teks lama']]) {
    k.push(`  ${fg} di #ffffff = ${cr(fg, '#ffffff').toFixed(2)}:1  ${what}`);
  }
  k.push('', 'calon border (butuh >=3.0 terhadap #0b0b0f):');
  for (const g of CALON_BORDER) {
    k.push(`  ${g} vs #0b0b0f = ${cr(g, '#0b0b0f').toFixed(2)}:1 · vs #1b1b22 = ${cr(g, '#1b1b22').toFixed(2)}:1`);
  }
  k.push('', 'calon teks disabled (butuh >=4.5 terhadap #16161c):');
  for (const g of CALON_DISABLED) k.push(`  ${g} vs #16161c = ${cr(g, '#16161c').toFixed(2)}:1`);
  k.push('', 'border dengan coverage 0,8 (COV di bawah):');
  for (const b of CALON_TERANG) {
    const vsHalaman = cr(blend(b, '#0b0b0f', cov), '#0b0b0f');
    const vsIsi = cr(blend(b, '#1b1b22', cov), '#1b1b22');
    const vsField = cr(blend(b, '#0f0f14', cov), '#0f0f14');
    const vsPanel = cr(blend(b, '#101016', cov), '#101016');
    const min = Math.min(vsHalaman, vsIsi, vsField, vsPanel);
    k.push(
      `  ${b}: tergambar ${blend(b, '#0b0b0f', cov)}/${blend(b, '#1b1b22', cov)} -> ` +
        `vsLayar ${vsHalaman.toFixed(2)} vsTombol ${vsIsi.toFixed(2)} vsField ${vsField.toFixed(2)} ` +
        `vsPanel ${vsPanel.toFixed(2)} · MIN ${min.toFixed(2)} ${min >= 3 ? 'LOLOS' : 'kurang'}`
    );
  }
  return k;
};

// Aturan di README: angka yang tidak diukur tidak boleh masuk dokumen. Dulu aturan itu
// cuma tulisan, dan README sendiri akhirnya memuat rentang border yang tidak pernah
// dicetak script ini (3,19-3,74) serta satu hex (#595965) yang tidak ada di output.
// Yang dicari adalah BENTUK baris output script ini (`#abc di #def = ...` dan
// `#abc: tergambar ...`) di SEMUA blok berpayung README, bukan satu blok yang ditunjuk
// lewat nama — kalau tidak, blok palsu kedua di halaman lain tidak akan pernah diperiksa.
export const cekKutipanREADME = (keluar, readmePath = new URL('../README.md', import.meta.url)) => {
  const readme = readFileSync(readmePath, 'utf8').split(/\r?\n/);
  const bentukOutput = /^\s+#[0-9a-f]{3,8}: tergambar |^\s*#[0-9a-f]{3,8} di #[0-9a-f]{3,8} = /i;
  const kutip = [];
  let dalamBlok = false;
  for (const [i, l] of readme.entries()) {
    if (l.startsWith('```')) {
      dalamBlok = !dalamBlok;
      continue;
    }
    if (dalamBlok && bentukOutput.test(l)) kutip.push({ n: i + 1, l });
  }
  const palsu = kutip.filter(({ l }) => !keluar.includes(l));
  const blok = new Set();
  for (const { n } of kutip) {
    let b = n;
    while (b > 1 && !readme[b - 2].startsWith('```')) b--;
    blok.add(b);
  }
  return { jumlah: kutip.length, blok: blok.size, palsu };
};

const dijalankanLangsung = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (dijalankanLangsung) {
  const keluar = barisOutput();
  for (const l of keluar) console.log(l);
  // Kalau COV diubah lewat env, baris coverage yang dicetak bukan baris yang dipakai
  // dokumen, jadi penjaga ini dilewati dengan sengaja — bukan dianggap lulus.
  if (process.env.COV) {
    console.log(`\npenjaga kutipan: DILEWATI (COV=${process.env.COV}, dokumen mengutip COV=0,8)`);
  } else {
    const k = cekKutipanREADME(keluar);
    if (!k.jumlah) {
      console.error('penjaga kutipan: README tidak mengutip satu pun baris output script ini');
      process.exit(1);
    }
    if (k.palsu.length) {
      console.error(`penjaga kutipan: ${k.palsu.length} baris README tidak ada di output script ini:`);
      for (const { n, l } of k.palsu) console.error(`  README:${n} |${l}|`);
      process.exit(1);
    }
    console.log(`\npenjaga kutipan: ${k.jumlah} baris README di ${k.blok} blok = verbatim output di atas`);
  }
}
