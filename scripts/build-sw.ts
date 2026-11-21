/**
 * M7: menulis `dist/sw.js` dari template + isi build.
 *
 * Dijalankan setelah `vite build` (lihat `npm run build`). Daftar aset diambil dari
 * `dist/index.html` — nama ber-hash tidak bisa ditulis tangan. Versi cache dihitung dari HTML +
 * daftar aset + template, jadi satu byte yang berubah
 * menghasilkan cache baru; cache lama baru dibuang setelah halaman pindah build.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { CACHE_PREFIX, daftarCache, namaCache, versiDari } from '../src/app/offline/manifest';

const DIST = 'dist';

/**
 * Service worker klasik adalah SKRIP, bukan modul: satu `export`/`import` membuat browser menolak
 * seluruh berkas, SW baru tidak pernah terpasang, dan kegagalannya bisu di runtime. `vm.Script`
 * memakai parser skrip V8 — parser yang sama yang dipakai service worker — jadi `export { … }`,
 * `import …`, atau `await` di tingkat atas gagal di sini, sebelum ada berkas yang ditulis.
 * Memeriksa nama fungsi saja tidak menangkap kelas kesalahan ini.
 */
function pastikanSkripKlasik(sumber: string, label: string): void {
  try {
    new Script(sumber, { filename: label });
  } catch (e) {
    throw new Error(`${label} bukan skrip klasik: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const template = readFileSync(join('scripts', 'sw-template.js'), 'utf8');
// Aturan pembersihan cache disuntikkan dari berkas yang sama yang diuji `scripts/sw-core.spec.ts`.
// Hanya `export` yang menempel pada deklarasi yang dibuang; `export { … }`, `export default`, dan
// `import` sengaja DIBIARKAN supaya pemeriksa skrip klasik di bawah menolaknya dengan bunyi.
// Membuang semua `export ` akan mengubah `export { x };` menjadi blok `{ x };` yang sah — persis
// kesalahan yang tidak boleh lolos diam-diam.
const aturan = readFileSync(join('scripts', 'sw-core.js'), 'utf8').replace(/^export (?=(?:async )?function\b|const\b|let\b|var\b|class\b)/gm, '');
if (!template.includes('/* __ATURAN_CACHE__ */')) {
  throw new Error('scripts/sw-template.js tidak memuat penanda /* __ATURAN_CACHE__ */ — aturan tidak bisa disuntikkan');
}
// Salinan aturan di template akan membuat fungsi yang diuji bukan fungsi yang dijalankan SW.
if (template.includes('function cacheYangBolehDihapus(')) {
  throw new Error('scripts/sw-template.js memuat salinan cacheYangBolehDihapus — hapus salinannya, biarkan injeksi yang mengisi');
}
// Gagal keras di sini, bukan hanya "nama fungsinya ada": sintaks modul yang lolos akan membuat
// dist/sw.js ditolak browser sebagai service worker.
pastikanSkripKlasik(aturan, 'scripts/sw-core.js (sesudah export dibuang)');
for (const fn of ['cacheYangBolehDihapus', 'bolehBersihkanCache', 'tipeCocok', 'precacheAset', 'statusPrecache']) {
  if (!aturan.includes(`function ${fn}(`)) {
    throw new Error(`scripts/sw-core.js tidak memuat ${fn} — aturan SW tidak bisa disuntikkan`);
  }
}
const aset = daftarCache(html);
if (!aset.includes('/')) {
  throw new Error("daftar aset tidak memuat '/' — shell wajib untuk precache");
}
// Jangan menulis daftar yang menunjuk berkas yang tidak ada: host dengan SPA fallback membalas
// URL aset yang hilang dengan 200 HTML, sehingga precache dapat menganggapnya berhasil dan
// menyimpan HTML sebagai JS/CSS. Gagal di build lebih awal dan lebih terbaca daripada offline
// shell yang tampak terpasang tetapi tidak bisa merender.
for (const url of aset) {
  if (url === '/') continue;
  const berkas = join(DIST, url.replace(/^\/+/, ''));
  if (!existsSync(berkas)) {
    throw new Error(`aset ${url} dirujuk index.html tetapi tidak ada di ${berkas}`);
  }
}
// Aturan yang disuntikkan ikut menentukan versi: mengubah sw-core.js saja harus menghasilkan cache
// baru, bukan cache lama dengan nama yang sama.
const versi = versiDari(html, aset, template + '\u0000' + aturan);

const sw = template
  .replace('/* __ATURAN_CACHE__ */', aturan.trim())
  .replace('__CACHE__', namaCache(versi))
  .replace('__AWALAN__', CACHE_PREFIX)
  .replace('__ASET__', JSON.stringify(aset));

if (sw.includes('__CACHE__') || sw.includes('__ASET__') || sw.includes('__AWALAN__') || sw.includes('__ATURAN_CACHE__')) {
  throw new Error('template sw masih memuat penanda yang tidak terisi');
}
// Berkas akhir juga diperiksa: injeksi yang sah bisa tetap menghasilkan skrip tidak sah kalau
// template atau penggantian penanda merusak struktur.
pastikanSkripKlasik(sw, 'dist/sw.js');

writeFileSync(join(DIST, 'sw.js'), sw);
console.log(`[sw] ${namaCache(versi)} — ${aset.length} aset, ${sw.length} byte`);
