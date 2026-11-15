// Gerbang bukti ikon. Dua hal dijaga di sini, dan keduanya pernah patah di tree ini:
//
// 1. FILE KEMBAR. Bug arah Marshal.Copy di buat-ikon.ps1 membuang seluruh hasil komposit,
//    jadi keenam ikon keluar sebagai kanvas #0b0b0f rata — dan paranoid-512.png keluar
//    identik byte dengan paranoid-maskable-512.png, karena satu-satunya perbedaan di
//    antara keduanya hidup tepat di komposit yang terbuang itu. Penjaga per-file
//    (`terang == 0`) tidak bisa melihatnya: dua file kembar sama-sama punya piksel terang.
//    Yang bisa melihatnya hanya perbandingan antar-berkas, jadi itu yang dijaga di sini.
//
// 2. STATUS BUKAN BUKTI. wrangler.jsonc memakai not_found_handling "single-page-application",
//    jadi /ikon/apapun-yang-tidak-ada balas 200 dengan text/html. Pemeriksaan yang menguji
//    ketersediaan ikon lewat status code LULUS UNTUK IKON YANG TIDAK ADA. Di sini yang diuji
//    Content-Type: image/png dan sha256 isi — plus satu kontrol positif yang membuktikan
//    aturan yang sama menolak path kosong.
//
// Bagian (1) dan (2) lokal diimpor scripts/gerbang.spec.ts sehingga ikut `npm run test`
// dan karena itu `npm run check`. `node scripts/gerbang-ikon.mjs` memakainya sebagai CLI.
// Bagian served TIDAK ikut check: ia butuh server yang hidup — `npm run cek:ikon:http`.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Header PNG: 8 byte magic, lalu chunk IHDR dengan lebar/tinggi big-endian di offset 16/20.
const ihdr = (buf) => {
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return png ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
};

export const cekIkon = () => {
  const gagal = [];
  const berkas = new Map();
  const namaBerkas = readdirSync(join(root, 'public', 'ikon')).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  for (const f of namaBerkas) {
    const buf = readFileSync(join(root, 'public', 'ikon', f));
    const d = ihdr(buf);
    if (!d) gagal.push(`public/ikon/${f}: bukan PNG (magic salah)`);
    berkas.set(`ikon/${f}`, { nama: `public/ikon/${f}`, buf, hash: sha(buf), w: d?.w, h: d?.h });
  }

  // (1) Tidak boleh ada dua ikon yang identik byte — ini penjaga anti-kembar.
  const perHash = new Map();
  for (const [, v] of berkas) perHash.set(v.hash, [...(perHash.get(v.hash) ?? []), v.nama]);
  const kembar = [...perHash].filter(([, nama]) => nama.length > 1);
  for (const [h, nama] of kembar) {
    gagal.push(`IKON KEMBAR: ${nama.join(' ≡ ')} sha256 sama (${h.slice(0, 16)}…) — maskable tidak boleh identik dengan 512 biasa`);
  }

  // (2) yang direferensikan dokumen harus benar-benar ada, dan ukuran yang ditulis = ukuran di file.
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const rujukan = [];
  for (const i of manifest.icons ?? []) rujukan.push({ src: i.src, sizes: i.sizes, type: i.type, dari: 'manifest.webmanifest' });
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    const rel = /rel="([^"]+)"/.exec(tag)?.[1] ?? '';
    if (!/icon/i.test(rel)) continue;
    rujukan.push({ src: /href="([^"]+)"/.exec(tag)?.[1], sizes: /sizes="([^"]+)"/.exec(tag)?.[1], type: /type="([^"]+)"/.exec(tag)?.[1], dari: `index.html rel="${rel}"` });
  }
  if (!manifest.icons?.some((i) => /\bmaskable\b/.test(i.purpose ?? ''))) gagal.push('manifest: tidak ada ikon purpose maskable');
  for (const r of rujukan) {
    const v = berkas.get(r.src.replace(/^\//, ''));
    if (!v) {
      gagal.push(`${r.dari}: ${r.src} tidak ada di public/ikon`);
      continue;
    }
    if (r.sizes) {
      const [w, h] = r.sizes.split('x').map(Number);
      if (w !== v.w || h !== v.h) gagal.push(`${r.dari}: sizes="${r.sizes}" tapi IHDR ${v.w}x${v.h} di ${r.src}`);
    }
    if (r.type !== undefined && r.type !== 'image/png') gagal.push(`${r.dari}: type="${r.type}" untuk file PNG`);
  }
  return { gagal, kembar, berkas, rujukan, namaBerkas };
};

// (3) served: content-type + sha isi, bukan status.
export const cekIkonServed = async (basis, berkas) => {
  const gagal = [];
  const baris = [];
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const src = new Set((manifest.icons ?? []).map((i) => i.src));
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    if (/rel="[^"]*icon[^"]*"/i.test(tag)) src.add(/href="([^"]+)"/.exec(tag)?.[1]);
  }
  for (const s of src) {
    const res = await fetch(basis + s);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? '';
    const lokal = berkas.get(s.replace(/^\//, ''));
    if (ct !== 'image/png') {
      gagal.push(`${s}: content-type "${ct}" (harus image/png — status ${res.status} BUKAN bukti, SPA fallback balas 200 text/html)`);
    }
    if (!lokal || sha(buf) !== lokal.hash) {
      gagal.push(`${s}: sha256 body ${sha(buf).slice(0, 16)}… ≠ lokal ${lokal?.hash.slice(0, 16)}… (berkas served bukan berkas yang di-commit)`);
    }
    baris.push(`${res.status} ${ct} ${buf.length} B ${sha(buf).slice(0, 16)}… ${s}`);
  }
  // Kontrol positif: path yang memang tidak ada harus DITOLAK oleh aturan yang sama.
  const res = await fetch(basis + '/ikon/tidak-ada.png');
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? '';
  baris.push(`kontrol positif ${res.status} "${ct}" ${buf.length} B /ikon/tidak-ada.png`);
  if (res.status !== 200) gagal.push('kontrol positif: /ikon/tidak-ada.png tidak balas 200 lagi — asumsi SPA fallback di file ini perlu ditulis ulang');
  if (ct === 'image/png') gagal.push('kontrol positif: ikon yang tidak ada balas image/png — pemeriksaan sha/content-type di atas tidak membuktikan apa pun');
  return { gagal, baris };
};

const dijalankanLangsung = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (dijalankanLangsung) {
  const { gagal, berkas, rujukan, namaBerkas } = cekIkon();
  console.log(`berkas di public/ikon (${namaBerkas.length} PNG):`);
  for (const [, v] of berkas) console.log(`  ${v.hash}  ${v.w}x${v.h}  ${v.nama}  ${v.buf.length} B`);
  console.log(`\nrujukan ikon di dokumen (${rujukan.length}):`);
  for (const r of rujukan) console.log(`  ${r.src} sizes=${r.sizes ?? '-'}  (${r.dari})`);

  const i = process.argv.indexOf('--served');
  const basis = i >= 0 ? process.argv[i + 1]?.replace(/\/$/, '') : null;
  if (basis) {
    const head = await fetch(basis + '/').catch(() => null);
    if (!head) {
      console.error(`\ngerbang ikon: ${basis} tidak menjawab — jalankan \`npm run preview\` dulu; penjaga ini TIDAK dianggap lulus kalau dilewati`);
      process.exit(1);
    }
    const s = await cekIkonServed(basis, berkas);
    console.log(`\nserved dari ${basis}:`);
    for (const l of s.baris) console.log('  ' + l);
    gagal.push(...s.gagal);
  }

  if (gagal.length) {
    console.error(`\ngerbang ikon: ${gagal.length} KLAIM GAGAL`);
    for (const g of gagal) console.error('  ' + g);
    process.exit(1);
  }
  console.log(`\ngerbang ikon: ${namaBerkas.length} berkas, ${rujukan.length} rujukan, tidak ada kembar, semua sha+IHDR cocok`);
}
