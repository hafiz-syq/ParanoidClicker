import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { barisOutput, cekKutipanREADME } from './cr.mjs';
import { cekIkon } from './gerbang-ikon.mjs';
import { hitungVersiSumber, periksaKesegaranSw, periksaSw } from './cek-sw.mjs';
import { daftarCache, versiDari } from '../src/app/offline/manifest';
import { asetDariSw, tipeCocok } from './cek-precache.mjs';

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

it('gerbang precache membaca ASET dan menolak tipe fallback HTML', () => {
  const sw = 'const ASET = ["/","/assets/a.js","/assets/a.css","/ikon/a.png"];\n';
  expect(asetDariSw(sw)).toEqual(['/', '/assets/a.js', '/assets/a.css', '/ikon/a.png']);
  expect(() => asetDariSw('self.addEventListener("install", () => {});')).toThrow('ASET');

  // Inilah bug yang dijaga: URL aset hilang dibalas 200 text/html oleh SPA fallback.
  expect(tipeCocok('/assets/a.js', 'text/html; charset=utf-8')).toBe(false);
  expect(tipeCocok('/assets/a.css', 'text/html; charset=utf-8')).toBe(false);
  expect(tipeCocok('/ikon/a.png', 'text/html; charset=utf-8')).toBe(false);
  expect(tipeCocok('/manifest.webmanifest', 'application/manifest+json')).toBe(true);
  expect(tipeCocok('/assets/a.js', 'text/javascript; charset=utf-8')).toBe(true);
  expect(tipeCocok('/assets/a.css', 'text/css')).toBe(true);
  expect(tipeCocok('/', 'text/html; charset=utf-8')).toBe(true);
});

it('gerbang /sw.js menolak text/html (SPA fallback) dan SW dari build lama', () => {
  const sw = "const CACHE = 'paranoidclick-1a2b3c4d';\nself.addEventListener('install', () => {});\n";

  // Yang pernah terjadi: manifes aset wrangler basi → /sw.js balas index.html dengan 200.
  // Manifes basi: /sw.js dilayani index.html. Dua keluhan sekaligus — content-type dan isi —
  // karena keduanya memang salah; kalau hanya content-type yang diperiksa, host yang melabeli
  // segalanya javascript akan lolos.
  const html = periksaSw({
    contentType: 'text/html; charset=utf-8',
    teks: '<!doctype html><html><body><div id="root"></div></body></html>',
    lokalTeks: sw,
  });
  expect(html.gagal).toHaveLength(2);
  expect(html.gagal.some((g: string) => g.includes('text/html')), 'text/html harus ditolak dengan alasannya').toBe(true);
  expect(html.gagal.some((g: string) => g.includes('bukan service worker')), 'isi selain dist/sw.js harus ditolak').toBe(true);

  // SW basi: content-type benar, tapi isinya bukan dist/sw.js saat ini.
  const basi = periksaSw({
    contentType: 'text/javascript; charset=utf-8',
    teks: sw,
    lokalTeks: sw.replace('1a2b3c4d', 'deadbeef'),
  });
  expect(basi.gagal.some((g: string) => g.includes('build lama')), 'versi served ≠ dist harus ditolak').toBe(true);

  // Jalur benar tidak boleh menghasilkan keluhan apa pun.
  const bersih = periksaSw({ contentType: 'text/javascript; charset=utf-8', teks: sw, lokalTeks: sw });
  expect(bersih.gagal).toEqual([]);
});

it('gerbang /sw.js menolak dist/sw.js yang lebih tua daripada sumbernya', () => {
  const html = '<script type="module" src="/assets/index-11111111.js"></script><link rel="stylesheet" href="/assets/index-22222222.css">';
  const template = "const CACHE = '__CACHE__';\n";
  const aturan = 'function cacheYangBolehDihapus() {}\n';
  const sumber = hitungVersiSumber({ html, template, aturan });

  // Salinan aturan versi di cek-sw.mjs harus sama dengan manifest.ts yang dipakai build.
  expect(sumber.aset).toEqual(daftarCache(html));
  expect(sumber.versi).toBe('paranoidclick-' + versiDari(html, daftarCache(html), template + '\u0000' + aturan));

  const sw = `const CACHE = '${sumber.versi}';\nself.addEventListener('install', () => {});\n`;
  expect(periksaKesegaranSw({ html, template, aturan, lokalTeks: sw }).gagal).toEqual([]);

  // Inilah kasus yang dulu lolos: served = dist/sw.js, tetapi keduanya build lama.
  const basi = periksaKesegaranSw({
    html,
    template,
    aturan,
    lokalTeks: "const CACHE = 'paranoidclick-deadbeef';\nself.addEventListener('install', () => {});\n",
  });
  expect(basi.gagal.some((g: string) => g.includes('lebih tua'))).toBe(true);

  // Perubahan template sumber juga harus membuat dist lama ditolak, meskipun isi HTML tetap.
  const ubah = periksaKesegaranSw({ html, template: template + '// sumber berubah\n', aturan, lokalTeks: sw });
  expect(ubah.gagal.some((g: string) => g.includes('lebih tua'))).toBe(true);

  // dist/sw.js tanpa versi tidak boleh dianggap segar.
  const tanpaVersi = periksaKesegaranSw({ html, template, aturan, lokalTeks: "self.addEventListener('install', () => {});\n" });
  expect(tanpaVersi.gagal.some((g: string) => g.includes('tidak memuat'))).toBe(true);
});

// (3) PROVENANSI KLAIM "PEMILIK". Kelas bug yang dilawan: commit 1a30bba menulis
// "Tafsir §6.2 — DIKONFIRMASI pemilik, 2026-11-16" dan "jawaban pemilik tetap: …" tanpa satu
// alamat pun yang bisa ditunjuk. Sesi checker lalu membaca daftar turn user sesi ini lewat
// read_chat_session, tidak menemukan apa pun di jam itu, dan menyimpulkan attribusinya fiktif —
// padahal jawabannya nyata, hanya kanalnya bukan turn chat: jawaban AskUserQuestion datang sebagai
// tool_result. Tidak ada yang berbohong, dan tidak ada yang bisa dibuktikan. Itu persis
// "penjaga yang cuma diklaim" versi dokumen, tipe yang sudah dibereskan di 97aa004.
//
// Aturan — setiap baris di README.md + docs/plans/** + docs/adr/** yang menyebut "pemilik" DAN
// mengklaim keputusan/perintah/jawaban harus membawa minimal satu:
//   [TANYA]            pertanyaan yang memang belum dijawab
//   via <uuid>@<UTC>   alamat turn: sessionId + timestamp ISO ber-Z, dibuka manusia di App
//   S<n>               kunci ke baris tabel provenance di BERKAS yang sama; baris tabelnya sendiri
//                      wajib memuat via/[TANYA], supaya S<n> tidak bisa jadi alamat hantu
// Baris di dalam pagar ``` dikecualikan: di situlah kutipan teks lama yang sedang dikoreksi
// ditaruh, dan teks lama itu memang berisi klaim yang sedang dibongkar.
//
// Batasannya ditulis, tidak disembunyikan: penjaga ini memeriksa BEN-TUK alamat, bukan isi
// transkrip. Transkrip sesi TIDAK bisa dibaca dari tes — kebijakan harness memblokir akses
// ~/.qoder/projects/*.jsonl di tengah tugas ini (16 Nov), jadi verifikasi sebuah alamat adalah
// kerja manusia membuka sesi itu. Yang dijaga mesin cuma satu: tidak ada klaim tanpa alamat.

type Baris = { berkas: string; n: number; teks: string };

const KLAIM_PEMILIK =
  /(keputusan|perintah|instruksi|syarat|jawaban|jawabannya|menjawab|dijawab|konfirmasi|ditanya|menyetujui|persetujuan|memilih)/i;
const P_TANYA = /\[TANYA\]/;
const P_VIA =
  /via [0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/;
const P_BARIS_KUNCI = /^\s*\|\s*S([1-9]\d?)\s*\|/;
const P_PAKAI_KUNCI = /(?<![A-Za-z0-9_])S([1-9]\d?)(?![0-9])/g;

const berkasDokumen = (): string[] => {
  const out = ['README.md'];
  for (const dir of ['docs/plans', 'docs/adr']) {
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (f.endsWith('.md')) out.push(`${dir}/${f}`);
    }
  }
  return out;
};

const cekProvenancePemilik = (paths: string[]) => {
  const klaim: Baris[] = [];
  const gagal: Baris[] = [];
  for (const rel of paths) {
    const baris = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/);
    const kunci = new Map<string, string>();
    let pagar = false;
    for (const t of baris) {
      if (/^```/.test(t.trim())) {
        pagar = !pagar;
        continue;
      }
      if (pagar) continue;
      const m = P_BARIS_KUNCI.exec(t);
      if (m) kunci.set('S' + m[1], t);
    }
    pagar = false;
    baris.forEach((t, i) => {
      if (/^```/.test(t.trim())) {
        pagar = !pagar;
        return;
      }
      if (pagar) return;
      if (!/pemilik/i.test(t) || !KLAIM_PEMILIK.test(t)) return;
      klaim.push({ berkas: rel, n: i + 1, teks: t });
      const beralamat =
        P_TANYA.test(t) ||
        P_VIA.test(t) ||
        Array.from(t.matchAll(P_PAKAI_KUNCI)).some((mm) => {
          const row = kunci.get('S' + mm[1]);
          return !!row && (P_VIA.test(row) || P_TANYA.test(row));
        });
      if (!beralamat) gagal.push({ berkas: rel, n: i + 1, teks: t });
    });
  }
  return { jumlah: klaim.length, gagal };
};

it('setiap klaim keputusan pemilik di dokumen membawa alamat sumber yang bisa ditunjuk', () => {
  const g = cekProvenancePemilik(berkasDokumen());
  // 0 berarti semua kalimat ber-atribusi pemilik dihapus — itu penjaganya dibungkam, bukan lulus.
  expect(g.jumlah, 'README/docs tidak menyisakan satu pun klaim pemilik — penjaga ini hilang, bukan lulus').toBeGreaterThan(0);
  expect(
    g.gagal.map(({ berkas, n, teks }: Baris) => `${berkas}:${n} |${teks.slice(0, 110)}|`),
    'klaim pemilik tanpa [TANYA] / via <sessionId>@<UTC> / S<n> yang baris tabelnya beralamat'
  ).toEqual([]);
});

// (4) PROVENANSI KLAIM "CHECKER". Kelas bug yang dilawan: TEMUAN 8 ronde #6 (18 Nov). Plan §8.6
// pernah membuka diagnosis `parseTarget` dengan "Yang checker minta (dirolay, tiga kali dengan bunyi
// sama)", padahal carrier tertua kalimat itu di transkrip sesi ini adalah `thinking` saya sendiri
// (baris 17745 @2026-11-17T00:14:12.432Z) yang melabelinya "the owner's TEMUAN 6 diagnosis" — dua
// label bertentangan untuk satu kalimat, dan tidak satu pun turn relay yang membawanya. Ringkasan
// kompresi (17778, 18177, 18438, …) datang SESUDAH thinking itu, jadi mereka penular, bukan sumber.
// Aturan (3) tidak menggigitnya karena baris itu tidak menyebut "pemilik". Jadi aturan kedua:
//   pemicu  kata kanal (checker|pemeriksa|dirolay) DAN kata klaim (minta|ungkap|diagnosis|laporan|
//           tunjuk|kata|nyatakan|simtom|melaporkan)
//   lulus   via <uuid SESI LAIN>@<UTC ber-Z>  — alamat prompt checker, bukan alamat sesi sendiri
//           ATAU penanda milik-sendiri `bukan kanal relay`, yang hanya boleh dipakai untuk klaim
//           yang memang bukan klaim relay
//   konflik satu kutipan backtick (>= 12 byte, >= 3 kata) yang di satu baris dilabeli kanal relay
//           dan di baris lain dilabeli `pemilik` = tanda tangan TEMUAN 8, meskipun masing-masing
//           barisnya beralamat. Baris yang menyebut DUA kanal sekaligus dilewati: itu kontras yang
//           disengaja ("bukan checker, melainkan pemilik"), bukan label ganda.
// Pagar ``` tetap dikecualikan, dan jumlah pemicu harus > 0 supaya "hapus semua kata" tidak lulus.
// Batasnya sama dengan (3): yang diperiksa BENTUK alamat dan BENTUK label, bukan isi transkrip.

const SESI_SENDIRI = 'd27c1add-d9ec-4675-b6e8-2044f92eae20';
const KANAL_RELAY = /(checker|pemeriksa|dirolay)/i;
const KLAIM_RELAY = /(minta|ungkap|diagnosis|laporan|tunjuk|kata|nyatakan|simtom|melaporkan)/i;
const P_MILIK_SENDIRI = /bukan kanal relay/;
const P_VIA_UUID =
  /via ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g;
const KANAL_PEMILIK = /pemilik/i;
const P_KUTIPAN = /`([^`\n]{12,})`/g;

const cekProvenanceRelay = (paths: string[]) => {
  const klaim: Baris[] = [];
  const gagal: Baris[] = [];
  const label = new Map<string, { relay: string[]; pemilik: string[] }>();
  for (const rel of paths) {
    const baris = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/);
    let pagar = false;
    baris.forEach((t, i) => {
      if (/^```/.test(t.trim())) {
        pagar = !pagar;
        return;
      }
      if (pagar) return;
      const alamat = `${rel}:${i + 1}`;
      const relay = KANAL_RELAY.test(t);
      const pemilik = KANAL_PEMILIK.test(t);
      if (relay !== pemilik) {
        for (const m of t.matchAll(P_KUTIPAN)) {
          const span = m[1];
          if ((span.match(/ /g) || []).length < 2) continue;
          const e = label.get(span) || { relay: [], pemilik: [] };
          (relay ? e.relay : e.pemilik).push(alamat);
          label.set(span, e);
        }
      }
      if (!relay || !KLAIM_RELAY.test(t)) return;
      klaim.push({ berkas: rel, n: i + 1, teks: t });
      const beralamat =
        P_MILIK_SENDIRI.test(t) || Array.from(t.matchAll(P_VIA_UUID)).some((m) => m[1] !== SESI_SENDIRI);
      if (!beralamat) gagal.push({ berkas: rel, n: i + 1, teks: t });
    });
  }
  const konflik = Array.from(label.entries())
    .filter(([, e]) => e.relay.length > 0 && e.pemilik.length > 0)
    .map(([span, e]) => `${span.slice(0, 60)} | relay ${e.relay.join(' ')} | pemilik ${e.pemilik.join(' ')}`);
  return { jumlah: klaim.length, gagal, konflik };
};

it('setiap klaim tentang kanal checker di dokumen beralamat sesi lain atau ditandai bukan kanal relay', () => {
  const g = cekProvenanceRelay(berkasDokumen());
  expect(g.jumlah, 'README/docs tidak menyisakan satu pun klaim kanal checker — penjaga ini hilang, bukan lulus').toBeGreaterThan(0);
  expect(
    g.gagal.map(({ berkas, n, teks }: Baris) => `${berkas}:${n} |${teks.slice(0, 110)}|`),
    'klaim kanal checker tanpa via <uuid sesi lain>@<UTC> dan tanpa penanda `bukan kanal relay`'
  ).toEqual([]);
  expect(g.konflik, 'satu kutipan yang sama dilabeli kanal relay di satu baris dan pemilik di baris lain').toEqual([]);
});
