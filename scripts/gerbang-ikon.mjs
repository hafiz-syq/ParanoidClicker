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
// Jalur: `npm run cek:ikon` ikut jalan di `npm run check` (tidak butuh server).
// `npm run cek:ikon:http <baseURL>` menambahkan pemeriksaan served; tidak ikut check karena
// butuh wrangler dev/preview yang hidup — tanpa itu dia exit 1, bukan diam-diam lulus.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ikonDir = join(root, 'public', 'ikon');
const gagal = [];
const cek = (ok, pesan) => {
  if (!ok) gagal.push(pesan);
  return ok;
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Header PNG: 8 byte magic, lalu chunk IHDR dengan lebar/tinggi big-endian di offset 16/20.
const ihdr = (buf, nama) => {
  if (!cek(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${nama}: bukan PNG (magic salah)`)) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

const berkasIkon = readdirSync(ikonDir).filter((f) => f.toLowerCase().endsWith('.png'));
const berkas = new Map();
for (const f of berkasIkon.sort()) {
  const buf = readFileSync(join(ikonDir, f));
  const d = ihdr(buf, `public/ikon/${f}`);
  berkas.set(`ikon/${f}`, { nama: `public/ikon/${f}`, buf, hash: sha(buf), ...(d ? { w: d.w, h: d.h } : {}) });
}
console.log(`berkas di public/ikon (${berkasIkon.length} PNG):`);
for (const [, v] of berkas) console.log(`  ${v.hash}  ${v.w}x${v.h}  ${v.nama}  ${v.buf.length} B`);

// (1) Tidak boleh ada dua ikon yang identik byte — ini penjaga anti-kembar.
const perHash = new Map();
for (const [url, v] of berkas) perHash.set(v.hash, [...(perHash.get(v.hash) ?? []), v.nama]);
for (const [h, nama] of perHash) cek(nama.length === 1, `IKON KEMBAR: ${nama.join(' ≡ ')} sha256 sama (${h.slice(0, 16)}…) — maskable tidak boleh identik dengan 512 biasa`);

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
cek(manifest.icons?.some((i) => /\bmaskable\b/.test(i.purpose ?? '')), 'manifest: tidak ada ikon purpose maskable');
console.log(`\nrujukan ikon di dokumen (${rujukan.length}):`);
for (const r of rujukan) {
  const v = berkas.get(r.src.replace(/^\//, ''));
  if (!cek(!!v, `${r.dari}: ${r.src} tidak ada di public/ikon`)) continue;
  if (r.sizes) {
    const [w, h] = r.sizes.split('x').map(Number);
    cek(w === v.w && h === v.h, `${r.dari}: sizes="${r.sizes}" tapi IHDR ${v.w}x${v.h} di ${r.src}`);
  }
  cek(r.type === undefined || r.type === 'image/png', `${r.dari}: type="${r.type}" untuk file PNG`);
  console.log(`  ${r.src} sizes=${r.sizes ?? '-'} -> IHDR ${v.w}x${v.h} ${v.buf.length} B  (${r.dari})`);
}

// (3) served: content-type + sha isi, bukan status.
const basis = (() => {
  const i = process.argv.indexOf('--served');
  return i >= 0 ? process.argv[i + 1]?.replace(/\/$/, '') : null;
})();
if (basis) {
  console.log(`\nserved dari ${basis}:`);
  const head = await fetch(basis + '/').catch(() => null);
  if (!cek(!!head, `${basis} tidak menjawab — jalankan \`npm run preview\` dulu, penjaga ini tidak dianggap lulus kalau dilewati`)) {
    // lanjut ke exit di bawah
  } else {
    for (const r of rujukan) {
      const res = await fetch(basis + r.src);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') ?? '';
      const lokal = berkas.get(r.src.replace(/^\//, ''));
      const ok = cek(ct === 'image/png', `${r.src}: content-type "${ct}" (harus image/png — status ${res.status} BUKAN bukti, SPA fallback balas 200 text/html)`);
      cek(lokal && sha(buf) === lokal.hash, `${r.src}: sha256 body ${sha(buf).slice(0, 16)}… ≠ lokal ${lokal?.hash.slice(0, 16)}… (berkas served bukan berkas yang di-commit)`);
      console.log(`  ${res.status} ${ct.padEnd(9)} ${String(buf.length).padStart(7)} B ${sha(buf).slice(0, 16)}… ${r.src}${ok ? '' : '  <-- GAGAL'}`);
    }
    // Kontrol positif: path yang memang tidak ada harus DITOLAK oleh aturan yang sama.
    const res = await fetch(basis + '/ikon/tidak-ada.png');
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? '';
    console.log(`  kontrol positif  ${res.status} "${ct}" ${buf.length} B /ikon/tidak-ada.png`);
    cek(res.status === 200, 'kontrol positif: /ikon/tidak-ada.png tidak balas 200 lagi — asumsi SPA fallback di file ini perlu ditulis ulang');
    cek(ct !== 'image/png', 'kontrol positif: ikon yang tidak ada balas image/png — pemeriksaan sha/content-type di atas tidak membuktikan apa pun');
  }
}

if (gagal.length) {
  console.error(`\ngerbang ikon: ${gagal.length} KLAIM GAGAL`);
  for (const g of gagal) console.error('  ' + g);
  process.exit(1);
}
console.log(`\ngerbang ikon: ${berkasIkon.length} berkas, ${rujukan.length} rujukan, tidak ada kembar, semua sha+IHDR+content-type cocok`);
