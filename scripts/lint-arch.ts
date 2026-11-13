// Penjaga arsitektur: src/app/sync/ adalah matematika sinkroni murni.
// Aturan ini ditegakkan karena "sinkron = harga mati" — kalau servo suatu hari diam-diam
// memanggil navigator atau AudioContext, unit test-nya tetap hijau sementara kodenya tidak
// bisa lagi dipindah ke Web Worker atau ke Capacitor tanpa DOM.
// Sengaja tanpa dependensi: satu aturan larangan impor bukan alasan untuk memasang eslint.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'app', 'sync');

// Boleh diimpor, tapi hanya lewat jalur relatif — tanpa 'react', tanpa 'node:fs', tanpa lib.
// Semua bentuk yang bisa membawa kode masuk ke src/app/sync. Dulu satu pola `import ... from`
// sebaris, dan probe membuktikan empat jalur lolos: impor multi-baris (prettier membungkus
// impor panjang persis seperti ini), side-effect import, import() dinamis, dan require().
// [^;] menahan klaim supaya tidak menelan statement berikutnya di file bersikoma.
const IMPORT_FORMS: [string, RegExp][] = [
  ['import ... from', /(?:^|\n)[ \t]*import\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g],
  ['export ... from', /(?:^|\n)[ \t]*export\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g],
  ['side-effect import', /(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g],
  ['import() dinamis', /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  ['require()', /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
];

// TIER A — nama yang tidak pernah masuk akal jadi local di matematika sinkroni: disebut saja
// sudah pelanggaran, termasuk lewat `const { fetch: f } = globalThis` dan `window['alert']`.
const BARE_GLOBALS: [string, RegExp][] = [
  'globalThis',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'AudioContext',
  'webkitAudioContext',
  'OfflineAudioContext',
  'navigator',
  'document',
  'window',
  'matchMedia',
  'addEventListener',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'crossOriginIsolated',
].map((n) => [n, new RegExp(`\\b${n}\\b`)] as [string, RegExp]);

// TIER B — nama yang bisa sah jadi parameter lokal, jadi yang diperiksa adalah bentuk
// aksesnya. BATAS JUJUR: `const h = history;` tanpa titik tidak terlihat oleh aturan ini,
// karena membedakan global dari parameter lokal butuh analisis scope, bukan regex.
// Blind spot itu diterima sadar: history/location tidak pernah dipanggil di matematika
// sinkroni tanpa titik, dan pura-pura menutupinya bikin penjaga ini lebih lemah saat
// dibaca daripada saat dijalankan.
const MEMBER_FORMS: [string, RegExp][] = [
  ['location.', /\blocation\s*[.[]/],
  ['history.', /\bhistory\s*[.[]/],
  ['fetch(', /\bfetch\s*\(/],
  ['new Worker', /\bnew\s+Worker\s*[(\s]/],
  ['new Audio*', /\bnew\s+(?:webkit|Offline)?AudioContext\b/],
];

// Komentar dibuang untuk SEMUA pemeriksaan. String literal HANYA dibuang untuk pemeriksaan
// identifier: kalau ikut dibuang saat memeriksa impor, pola from\s+['"]...['"] tidak pernah
// cocok lagi dan aturan impor tadi jadi dekorasi (terbukti oleh probe).
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const stripStrings = (src: string) => src.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, 'STR');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

const failures: string[] = [];
const files = tsFiles(ROOT);

for (const file of files) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  const code = stripComments(readFileSync(file, 'utf8'));
  const codeNoStrings = stripStrings(code);
  for (const [form, re] of IMPORT_FORMS) {
    for (const m of code.matchAll(re)) {
      const spec = String(m[1]);
      if (!spec.startsWith('.')) {
        failures.push(`${rel}: ${form} '${spec}' — sync harus murni, tanpa react/node/lib`);
        continue;
      }
      const target = join(file, '..', spec).replace(/\\/g, '/');
      for (const layer of ['src/worker', 'src/screens', 'src/app/components']) {
        if (target.includes(layer)) {
          failures.push(`${rel}: ${form} menarik kode dari ${layer} — sinkroni tidak boleh menyentuh layer itu`);
        }
      }
    }
  }
  for (const [name, re] of BARE_GLOBALS) {
    if (re.test(codeNoStrings)) failures.push(`${rel}: menyebut global browser '${name}' — matematika sinkroni harus murni`);
  }
  for (const [name, re] of MEMBER_FORMS) {
    if (re.test(codeNoStrings)) failures.push(`${rel}: memakai ${name} — API browser di dalam matematika sinkroni`);
  }
}

if (failures.length) {
  console.error(`lint:arch TEMUKAN ${failures.length} pelanggaran di ${files.length} berkas:`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`lint:arch OK — ${files.length} berkas src/app/sync bersih (bare impor, API browser, layer lain)`);
