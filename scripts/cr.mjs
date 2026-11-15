// Hitung contrast ratio (CR) WCAG untuk pasangan warna yang dipakai layar.
// Rumus: WCAG 2.2 definisi contrast ratio (relative luminance, koefisien 0.2126/0.7152/0.0722).
// Dipakai sebagai gerbang bukti A1: angka ini yang dilaporkan, bukan kata "sudah kontras".
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (hex) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? [...h].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const [r, g, b] = f.map((x) => parseInt(x, 16) / 255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const cr = (a, b) => {
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
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

for (const [fg, bg, what] of PAIRS) {
  const v = cr(fg, bg);
  const teks = v >= 4.5 ? 'AA teks' : v >= 3 ? 'hanya non-teks' : 'GAGAL';
  console.log(`${fg} di ${bg} = ${v.toFixed(2)}:1  [${teks}]  ${what}`);
}
console.log('\ncalon border (butuh >=3.0 terhadap #0b0b0f):');
for (const g of ['#444444', '#555555', '#5e5e5e', '#636363', '#808088', '#707070']) {
  console.log(`  ${g} vs #0b0b0f = ${cr(g, '#0b0b0f').toFixed(2)}:1 · vs #1b1b22 = ${cr(g, '#1b1b22').toFixed(2)}:1`);
}
console.log('\ncalon teks disabled (butuh >=4.5 terhadap #16161c):');
for (const g of ['#8a8a96', '#909098', '#9a9ab0', '#a0a0a8']) {
  console.log(`  ${g} vs #16161c = ${cr(g, '#16161c').toFixed(2)}:1`);
}

// --- batas dengan PENYIMPANGAN render yang terukur di browser bukti ---
// Di Chromium tempat screenshot diambil, border 1px punya lebar computed 0,8px: piksel
// yang digambar = 0,8*warna + 0,2*warna di belakangnya (terbukti: #808088 di atas
// #0b0b0f keluar sebagai rgb(89,89,101)). Jadi yang harus lolos 3:1 adalah warna
// HASIL CAMPURAN itu, bukan warna yang ditulis di CSS.
const blend = (fg, bg, cov) => {
  const h = (x) => x.replace('#', '').match(/../g).map((v) => parseInt(v, 16));
  const [a, b] = [h(fg), h(bg)];
  return '#' + a.map((v, i) => Math.round(cov * v + (1 - cov) * b[i]).toString(16).padStart(2, '0')).join('');
};
console.log('\nborder dengan coverage 0,8 (COV di bawah):');
for (const cov of [Number(process.env.COV ?? 0.8)]) {
  for (const b of ['#6b6b78', '#75757f', '#7a7a85', '#808088']) {
    const vsHalaman = cr(blend(b, '#0b0b0f', cov), '#0b0b0f');
    const vsIsi = cr(blend(b, '#1b1b22', cov), '#1b1b22');
    const vsField = cr(blend(b, '#0f0f14', cov), '#0f0f14');
    const vsPanel = cr(blend(b, '#101016', cov), '#101016');
    const min = Math.min(vsHalaman, vsIsi, vsField, vsPanel);
    console.log(
      `  ${b}: tergambar ${blend(b, '#0b0b0f', cov)}/${blend(b, '#1b1b22', cov)} -> ` +
        `vsLayar ${vsHalaman.toFixed(2)} vsTombol ${vsIsi.toFixed(2)} vsField ${vsField.toFixed(2)} ` +
        `vsPanel ${vsPanel.toFixed(2)} · MIN ${min.toFixed(2)} ${min >= 3 ? 'LOLOS' : 'kurang'}`
    );
  }
}
