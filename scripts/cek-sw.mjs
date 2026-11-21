// Gerbang /sw.js. Satu kegagalan nyata dijaga di sini: yang disajikan bukan service worker dari
// build ini. Dua bentuknya:
//
// 1. MANIFES ASET BASI. `dist/sw.js` ditulis sesudah server start → wrangler masih memakai manifes
//    lama dan /sw.js dibalas SPA fallback: 200 OK, `Content-Type: text/html`, isi index.html.
//    Browser gagal mendaftarkan service worker tanpa pesan jelas.
// 2. SW BASI. `sw.js` build sebelumnya: content-type benar, daftar asetnya sudah tidak ada.
// 3. SUMBER LEBIH BARU. `dist/sw.js` tidak dibangun ulang sesudah template/aturan berubah; served
//    dan dist bisa sama-sama lama, jadi perbandingan byte saja tidak cukup.
//
// Karena itu versi sumber dihitung lebih dulu dan dibandingkan dengan versi di `dist/sw.js`, lalu
// isi served dibandingkan byte-per-byte dengan `dist/sw.js`. Perbandingan byte saja tidak membuktikan
// apa pun (host yang salah bisa melabeli segalanya javascript), dan SW lama yang di-serve ulang tetap
// lolos content-type.
//
// `periksaSw` murni dan diimpor scripts/gerbang.spec.ts, jadi ikut `npm run check` tanpa server.
// Bagian served butuh server hidup: `npm run cek:sw:http` (setelah `npm run build`).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSI = /const CACHE = '(paranoidclick-[0-9a-f]{8})'/;
const JAVASCRIPT = /(javascript|ecmascript)/;
const CACHE_PREFIX = 'paranoidclick-';
const SHELL = '/';

// Salinan kecil dari aturan build (`src/app/offline/manifest.ts`). `cek-sw.mjs` dijalankan dengan
// `node`, jadi ia tidak bisa mengimpor berkas TypeScript itu. Tes di `gerbang.spec.ts`
// membandingkan hasilnya dengan `versiDari` asli supaya salinan ini tidak diam-diam menyimpang.
function fnv1a(teks) {
  let h = 0x811c9dc5;
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function asetDariHtml(html) {
  const aset = [];
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    const url = m[1];
    if (url && !aset.includes(url)) aset.push(url);
  }
  return aset;
}

function hitungVersiSumber({ html, template, aturan }) {
  const aset = [SHELL, ...asetDariHtml(html)];
  return {
    aset,
    versi: `${CACHE_PREFIX}${fnv1a([html, [...aset].sort().join('\n'), template + '\u0000' + aturan].join('\u0000'))}`,
  };
}

/**
 * Tidak cukup membandingkan served dengan dist/sw.js: keduanya bisa sama-sama build lama.
 * Hitung versi dari HTML build + template/aturan sumber saat ini, lalu bandingkan dengan versi
 * yang tertanam di dist/sw.js. Ini menangkap `dist/sw.js` yang lebih tua daripada sumbernya.
 */
export const periksaKesegaranSw = ({ html, template, aturan, lokalTeks }) => {
  const gagal = [];
  const versiDist = VERSI.exec(lokalTeks)?.[1] ?? null;
  const { aset, versi: versiSumber } = hitungVersiSumber({ html, template, aturan });

  if (!versiDist) {
    gagal.push('/sw.js: dist/sw.js tidak memuat const CACHE = paranoidclick-… — tidak bisa membuktikan build berasal dari sumber ini');
  } else if (versiDist !== versiSumber) {
    gagal.push(
      `/sw.js: dist/sw.js lebih tua daripada sumber (dist ${versiDist}, sumber ${versiSumber}) — jalankan \`npm run build\` sebelum memeriksa server`,
    );
  }
  return { gagal, aset, versiDist, versiSumber };
};

export { hitungVersiSumber };

export const periksaSw = ({ contentType, teks, lokalTeks }) => {
  const gagal = [];
  const ct = (contentType ?? '').toLowerCase();
  const versi = VERSI.exec(teks)?.[1] ?? null;

  if (!JAVASCRIPT.test(ct)) {
    gagal.push(
      `/sw.js: content-type "${ct}" — harus javascript. text/html berarti yang dilayani SPA fallback (manifes aset wrangler basi), bukan service worker`,
    );
  }
  if (teks !== lokalTeks) {
    const versiLokal = VERSI.exec(lokalTeks)?.[1] ?? '-';
    gagal.push(
      `/sw.js: body served ≠ dist/sw.js (served ${versi ?? '-'}, dist ${versiLokal}) — server menyajikan build lama atau index.html, bukan service worker`,
    );
  }
  return { gagal, ct, versi };
};

const dijalankanLangsung = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
// Tanpa `process.exit`: di Windows, keluar paksa saat fetch masih terbuka memicu assertion libuv
// dan exit code 127, yang di CI terbaca sebagai "crash", bukan "pemeriksaan gagal".
const main = async () => {
  const i = process.argv.indexOf('--served');
  const basis = i >= 0 ? process.argv[i + 1]?.replace(/\/$/, '') : null;
  if (!basis) {
    console.error('pakai: node scripts/cek-sw.mjs --served http://localhost:8787');
    process.exitCode = 1;
    return;
  }

  let lokalTeks;
  let html;
  let template;
  let aturan;
  try {
    lokalTeks = readFileSync(join(root, 'dist', 'sw.js'), 'utf8');
    html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    template = readFileSync(join(root, 'scripts', 'sw-template.js'), 'utf8');
    aturan = readFileSync(join(root, 'scripts', 'sw-core.js'), 'utf8').replace(/^export (?=(?:async )?function\b|const\b|let\b|var\b|class\b)/gm, '');
  } catch (e) {
    console.error(`gerbang sw: berkas sumber/build tidak lengkap — jalankan \`npm run build\` dulu (${String(e)})`);
    process.exitCode = 1;
    return;
  }

  const segar = periksaKesegaranSw({ html, template, aturan, lokalTeks });
  console.log(`kesegaran: dist=${segar.versiDist ?? '-'} sumber=${segar.versiSumber}`);
  if (segar.gagal.length) {
    console.error(`\ngerbang sw: dist/sw.js BASI TERHADAP SUMBER`);
    for (const g of segar.gagal) console.error('  ' + g);
    process.exitCode = 1;
    return;
  }

  const res = await fetch(`${basis}/sw.js`).catch(() => null);
  if (!res) {
    console.error(`gerbang sw: ${basis} tidak menjawab — jalankan \`npm run preview\` dulu; penjaga ini TIDAK lulus kalau dilewati`);
    process.exitCode = 1;
    return;
  }

  const teks = await res.text();
  const { gagal, ct, versi } = periksaSw({ contentType: res.headers.get('content-type'), teks, lokalTeks });

  console.log(`cek ${basis}/sw.js:`);
  console.log(`  ${res.status} "${ct}" ${Buffer.byteLength(teks)} B versi=${versi ?? '-'} isi=${teks === lokalTeks ? 'dist/sw.js' : 'BUKAN dist/sw.js'}`);

  if (gagal.length) {
    console.error(`\ngerbang sw: ${gagal.length} KLAIM GAGAL`);
    for (const g of gagal) console.error('  ' + g);
    process.exitCode = 1;
    return;
  }
  console.log('\ngerbang sw: javascript, isi = dist/sw.js, versi cocok dengan sumber');
};

if (dijalankanLangsung) await main();
