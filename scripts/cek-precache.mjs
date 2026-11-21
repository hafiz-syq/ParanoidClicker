// Gerbang precache: setiap URL di `const ASET = [...]` milik dist/sw.js harus
// mengembalikan berkas yang sama dengan salinan lokalnya, dengan content-type yang masuk akal.
//
// Alasan gerbang ini ada: host dengan SPA fallback membalas URL yang hilang dengan
// 200 text/html. `cache.addAll` melihat status 200 dan menganggapnya berhasil; ikon/aset
// yang tidak ada lalu tersimpan sebagai HTML tanpa error. Perbandingan byte dengan
// dist/ menutup kasus itu, dan content-type memberi pesan yang lebih terbaca.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tipeCocok } from './sw-core.js';

// Satu definisi tipe dengan SW: kalau keduanya berbeda, gerbang bisa lulus sementara SW menolak
// aset yang sama (atau sebaliknya).
export { tipeCocok };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASET_RE = /const ASET = (\[[^\n]*\]);/;

/** Ambil daftar precache dari hasil build, bukan dari sumber yang mungkin berbeda. */
export function asetDariSw(teks) {
  const m = ASET_RE.exec(teks);
  if (!m) throw new Error('dist/sw.js tidak memuat `const ASET = [...]`');
  let aset;
  try {
    aset = JSON.parse(m[1]);
  } catch {
    throw new Error('`ASET` di dist/sw.js bukan JSON yang sah');
  }
  if (!Array.isArray(aset) || aset.length === 0 || aset.some((url) => typeof url !== 'string' || !url.startsWith('/'))) {
    throw new Error('`ASET` di dist/sw.js harus berisi URL absolut yang tidak kosong');
  }
  return aset;
}

function jalurLokal(url) {
  if (url === '/') return join(root, 'dist', 'index.html');
  return join(root, 'dist', url.replace(/^\/+/, ''));
}

const dijalankanLangsung = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const main = async () => {
  const i = process.argv.indexOf('--served');
  const basis = i >= 0 ? process.argv[i + 1]?.replace(/\/$/, '') : null;
  if (!basis) {
    console.error('pakai: node scripts/cek-precache.mjs --served http://localhost:8787');
    process.exitCode = 1;
    return;
  }

  let swTeks;
  try {
    swTeks = readFileSync(join(root, 'dist', 'sw.js'), 'utf8');
  } catch {
    console.error('gerbang precache: dist/sw.js tidak ada — jalankan `npm run build` dulu');
    process.exitCode = 1;
    return;
  }

  let aset;
  try {
    aset = asetDariSw(swTeks);
  } catch (e) {
    console.error(`gerbang precache: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`cek precache ${basis} — ${aset.length} URL dari dist/sw.js`);
  const gagal = [];
  for (const url of aset) {
    const lokalPath = jalurLokal(url);
    let lokal = null;
    try {
      lokal = readFileSync(lokalPath);
    } catch {
      // Tetap fetch URL-nya di bawah supaya laporan bisa menunjukkan fallback HTML-nya.
    }

    let res = null;
    try {
      res = await fetch(`${basis}${url}`, { cache: 'no-store' });
    } catch {
      // Dilaporkan sebagai kegagalan di bawah.
    }

    const errors = [];
    if (!lokal) errors.push(`tidak ada di dist (${lokalPath})`);
    if (!res) {
      errors.push('fetch gagal');
    } else {
      if (res.status !== 200) errors.push(`status ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      if (!tipeCocok(url, ct)) {
        const diharapkan = url === '/' ? 'text/html' : url.endsWith('.js') ? 'javascript' : url.endsWith('.css') ? 'text/css' : 'bukan text/html';
        errors.push(`content-type "${ct}" (diharapkan ${diharapkan})`);
      }
      let served = null;
      try {
        served = Buffer.from(await res.arrayBuffer());
      } catch {
        errors.push('body tidak bisa dibaca');
      }
      if (lokal && served && !lokal.equals(served)) {
        errors.push(`body ≠ dist (${lokal.length} B lokal vs ${served.length} B served)`);
      }
      if (lokal && served) {
        console.log(
          `${errors.length ? 'GAGAL' : 'OK'} ${url} — ${res.status} "${ct}" ${served.length} B${errors.length ? `: ${errors.join('; ')}` : ''}`,
        );
      } else {
        console.log(`${errors.length ? 'GAGAL' : 'OK'} ${url}${errors.length ? `: ${errors.join('; ')}` : ''}`);
      }
    }
    if (errors.length) gagal.push(`${url}: ${errors.join('; ')}`);
  }

  if (gagal.length) {
    console.error(`\ngerbang precache: ${gagal.length}/${aset.length} URL GAGAL`);
    for (const g of gagal) console.error(`  ${g}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\ngerbang precache: ${aset.length}/${aset.length} URL cocok dengan dist`);
};

if (dijalankanLangsung) await main();
