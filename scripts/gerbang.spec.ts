import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
