// Tes serangan otomatis untuk spike M0: §15 T5, T6, T7, T9.
// Jalankan setelah `npm run dev:worker` (atau terhadap deployment sendiri):
//   npx tsx scripts/attack.ts
//   PC_BASE_URL=https://paranoidclick.<akun>.workers.dev PC_LOG_FILE=/tmp/pc-dev.log npx tsx scripts/attack.ts
// BATAS: hanya boleh ke URL milik sendiri. Tidak ada permintaan ke pihak ketiga di sini.
// Kerangka T1/T2/T3/T4/T8/T10/T11 ikut baris ini nanti, begitu cmd.* dan join ada.
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { genSid } from '../src/shared/ids';

const BASE = process.env['PC_BASE_URL'] ?? 'http://127.0.0.1:8787';
const LOG = process.env['PC_LOG_FILE'] ?? '';

// Kunci rate limiter diambil dari CF-Connecting-IP. Di lokal header ini bebas dipalsukan, dan
// tiap sesi uji mengambil alamat TEST-NET acak supaya tes yang beruntun tidak saling mengunci.
// Di produksi TIDAK bisa sama sekali: edge Cloudflare menjawab 403 dengan halaman HTML miliknya
// sendiri untuk permintaan yang membawa header itu, tanpa menjalankan Worker (terukur 2026-11-13
// terhadap paranoidclick.hafizsyq.workers.dev). Satu percobaan sending header itu ke produksi
// membuat SEMUA status tes terbaca 403 — T5b bahkan akan "lulus" karena kebetulan angkanya sama,
// padahal yang menjawab Cloudflare, bukan gerbang token kita.
const testIp = () => `198.51.100.${10 + Math.floor(Math.random() * 200)}`;
const ownIp = testIp();
const LOCAL = /^https?:\/\/(127\.|localhost|\[::1\])/.test(BASE);
const fakeIp = (ip: string): Record<string, string> => (LOCAL ? { 'CF-Connecting-IP': ip } : {});

// fetch (undici) menolak header Upgrade, jadi handshake palsu harus lewat node:http(s).
// Modul dan port default dipilih dari skema BASE: kalau selalu node:http + port 80, tes ke
// workers.dev (https) akan mengirim HTTP polos, mendapat redirect 301 dari Cloudflare, dan
// membaca status itu sebagai kalau-nya Worker — bukan status handshake yang sebenarnya.
function statusWithUpgrade(path: string, ip: string): Promise<{ status: number; type: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE);
    const secure = u.protocol === 'https:';
    const req = (secure ? httpsRequest : httpRequest)(
      {
        hostname: u.hostname,
        port: u.port || (secure ? 443 : 80),
        method: 'GET',
        path,
        // Kunci handshake yang sah (contoh dari RFC 6455). Tanpa Sec-WebSocket-Key/Version,
        // edge Cloudflare menolak permintaannya sendiri dengan 403/400 ber-HTML dan Worker
        // tidak pernah menjawab — sementara workerd lokal cukup longgar untuk meneruskannya,
        // jadi tes ini hijau di lokal dan buta di produksi.
        headers: {
          ...fakeIp(ip),
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? '') });
      }
    );
    req.on('error', reject);
    req.end();
  });
}


let failed = 0;
function check(id: string, ok: boolean, line: string): void {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'GAGAL'}  ${id}  ${line}`);
}

const wsUrl = (path: string) => `${BASE.replace(/^http/, 'ws')}${path}`;

// Satu sesi sah untuk semua uji WS: /create dibatasi 3/menit, dan tiap bom socket
// tidak boleh menghabiskan jatah itu.
// Ini juga kendali positif seluruh suite: kalau permintaan ini saja tidak dijawab Worker
// dengan JSON, semua tes di bawahnya cuma mengukur sesuatu yang lain.
const createRes = await fetch(`${BASE}/create`, { method: 'POST', headers: fakeIp(ownIp) });
const createText = await createRes.text();
let created: { sid?: string; token?: string; wsPath?: string };
try {
  created = JSON.parse(createText) as typeof created;
} catch {
  throw new Error(
    `/create → HTTP ${createRes.status}, content-type "${createRes.headers.get('content-type')}", ` +
      `belum JSON: ${createText.slice(0, 80)}\n` +
      `Permintaanmu tidak sampai ke Worker. Terhadap workers.dev: jangan kirim CF-Connecting-IP ` +
      `(edge menjawab 403 HTML), dan pastikan PC_BASE_URL milik sendiri.`
  );
}
if (typeof created.sid !== 'string' || typeof created.wsPath !== 'string') {
  throw new Error(`/create gagal — jalankan npm run dev:worker dulu. Jawab: ${JSON.stringify(created)}`);
}
const sid = created.sid;
const wsPath = created.wsPath;
console.log(`sesi uji sid=${sid}`);

interface Probe {
  codes: string[];
  closeCode: number;
}

function codeOf(frame: string): string {
  try {
    const f = JSON.parse(frame) as Record<string, unknown>;
    return String(f.code ?? f.t);
  } catch {
    return 'UNPARSEABLE';
  }
}

// Kirim satu payload di socket baru, tunggu sampai gerbang menjawab.
// Batas 700 ms buta itu hanya sah di localhost: mengunggah frame 1 MB dan 12 MB ke
// workers.dev dari laptop butuh jauh lebih lama, dan bom besar terbaca "close=1000 tanpa
// frame" padahal perjalanannya belum selesai — kegagalan alat ukur, bukan kegagalan Worker.
const BOMB_DEADLINE_MS = 15_000;

function bomb(payload: string): Promise<Probe> {
  return new Promise<Probe>((resolve) => {
    const ws = new WebSocket(wsUrl(wsPath));
    const raw: string[] = [];
    let settled = false;
    const finish = (closeCode: number) => {
      if (settled) return;
      settled = true;
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'selesai');
      resolve({ codes: raw.map(codeOf), closeCode });
    };
    ws.addEventListener('message', (ev) => {
      const frame = String(ev.data);
      raw.push(frame);
      // Frame apa pun selain welcome/state berarti keputusan gerbang sudah jatuh; berhenti di
      // welcome saja akan melaporkan "lulus" untuk bom yang belum dijawab. `state` ikut
      // dilewati karena hello sekarang dibalas dua frame: bom berbentuk hello yang sah tidak
      // boleh dianggap keputusan.
      const code = codeOf(frame);
      if (code !== 'welcome' && code !== 'state') finish(1000);
    });
    ws.addEventListener('close', (ev) => finish(ev.code));
    ws.addEventListener('error', () => finish(0));
    ws.addEventListener('open', () => ws.send(payload), { once: true });
    setTimeout(() => finish(1000), BOMB_DEADLINE_MS);
  });
}

const show = (p: Probe) => (p.codes.length ? p.codes.join(',') : `close=${p.closeCode} tanpa frame`);

// DO masih hidup = socket baru ke sesi yang sama boleh hello + ping dan dijawab pong.
async function doAlive(): Promise<boolean> {
  const ws = new WebSocket(wsUrl(wsPath));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('gagal connect')), { once: true });
  });
  const answer = new Promise<string>((resolve) => {
    ws.addEventListener('message', (ev) => {
      if (codeOf(String(ev.data)) === 'pong') resolve('pong');
    });
    setTimeout(() => resolve('tidak'), 1500);
  });
  ws.send(JSON.stringify({ t: 'hello', sid, did: 'attackprobe' }));
  ws.send(JSON.stringify({ t: 'ping', nonce: 1, t1: Date.now() }));
  const got = await answer;
  ws.close(1000, 'selesai');
  return got === 'pong';
}

console.log('\n--- T6/T7: payload jahat, gerbang sebelum parse ---');

const b6a = await bomb(JSON.stringify({ t: 'ping', nonce: 1, t1: 1, pad: 'A'.repeat(1_000_000) }));
check('T6a', b6a.codes.includes('TOO_BIG'), `1 MB string → ${show(b6a)}`);

// Array murni juga harus lewat gerbang yang sama, bukan cuma objek.
// 500 kurung sengaja di bawah 8192 byte supaya yang diuji gerbang kedalaman, bukan ukuran.
const b6b = await bomb('['.repeat(500));
check('T6b', b6b.codes.includes('TOO_DEEP'), `500 kurung → ${show(b6b)}`);

const b6c = await bomb(JSON.stringify({ t: 'ping', nonce: 1, t1: 1, pad: 'B'.repeat(12_000_000) }));
check('T6c', b6c.codes.includes('TOO_BIG') || b6c.closeCode !== 1000, `12 MB frame → ${show(b6c)}`);

const b7 = await bomb('{"__proto__":{"comp":99999},"t":"ping"}');
check('T7a', b7.codes.includes('BAD_KEY'), `__proto__ → ${show(b7)}`);
check('T7b', ({} as Record<string, unknown>)['comp'] === undefined, 'Object.prototype proses ini tidak ternodai');

const bProto = await bomb('{"t":"cmd.tempo","bpm":999}');
check('T6e', bProto.codes.includes('PROTO'), `tipe tak dikenal → ${show(bProto)}`);

check('T6d', await doAlive(), 'DO tetap menjawab ping setelah semua bom');

console.log('\n--- T5: banjir pembuatan sesi ---');

const floodIp = testIp();
const statuses: number[] = [];
for (let i = 0; i < 30; i++) {
  statuses.push((await fetch(`${BASE}/create`, { method: 'POST', headers: fakeIp(floodIp) })).status);
}
const allowed = statuses.filter((s) => s === 200).length;
const throttled = statuses.filter((s) => s === 429).length;
// Di lokal limiter bekerja pada satu instans, jadi 3/60s persis dan boleh diuji keras.
// Di produksi tidak: "Rate limits are approximate and apply separately in each Cloudflare
// location" (dokumentasi Rate Limiting, 12 Nov 2026) — dari 30 permintaan banjir, terukur
// 7 lulus lewat colo yang berbeda-beda dan 23 pulang dengan 429. Itu sifat platform, bukan
// lubang di kode kita, dan memang bukan tempat pertahanannya: yang melarang sid karangan
// melahirkan DO adalah gerbang token (T5b).
// Yang diuji di sini cuma satu hal: limiter benar-benar menolak sebagian besar banjir.
const dinding = LOCAL ? allowed <= 3 && throttled >= 27 : throttled > 0 && allowed <= 15;
check(
  'T5a',
  dinding,
  `30 create dari 1 IP → ${allowed} lulus, ${throttled} 429${LOCAL ? ' (satu instans, batas 3)' : ' (per colo, approximate)'}`
);

// Sid yang bentuknya sempurna tapi tidak pernah keluar dari /create: dulu ini pintu
// belakangnya (1 DO SQLite per tebakan), sekarang harus 403 sebelum env.SESSION disentuh.
// Yang ditolak harus 403 MILIK KITA: Worker menjawab JSON, Cloudflare menjawab HTML.
// Tanpa syarat content-type, satu blokir edge saja bisa membuat tes ini hijau tanpa alasan.
const forged: { status: number; type: string }[] = [];
for (let i = 0; i < 30; i++) {
  forged.push(await statusWithUpgrade(`/ws?sid=${genSid()}&tok=${'a'.repeat(64)}`, testIp()));
}
const dariWorker = forged.every((f) => f.type.startsWith('application/json'));
const statusUnik = [...new Set(forged.map((f) => f.status))].join(',');
check(
  'T5b',
  forged.every((f) => f.status === 403) && dariWorker,
  `30 sid palsu → status unik ${statusUnik}, ${dariWorker ? 'dijawab Worker (JSON)' : 'BUKAN Worker (HTML edge)'}`
);

console.log('\n--- T9: jejak di log ---');

if (LOG && existsSync(LOG)) {
  // Tunggu tail benar-benar menulis: tanpa jeda, permintaan terakhir (30 forged 403 dari
  // T5b) bisa belum sampai ke file saat dibaca, dan T9b lolos karena lognya belum lengkap.
  await new Promise((r) => setTimeout(r, 1500));
  const text = readFileSync(LOG, 'utf8');
  const lines = text.split('\n').length;
  check('T9a', !text.includes('AAAA'), `isi payload tidak tertulis di log (${lines} baris, ${text.length} byte)`);
  check('T9b', !text.includes(created.token ?? '§'), 'token sesi tidak tertulis di log');
  // Kendali positif untuk T9b: sid dan tok duduk di query string yang sama, jadi kalau URL
  // itu tercatat maka sid pasti ikut muncul. Kalau sid pun tidak muncul, logger ini tidak
  // merekam query string sama sekali — T9b di atas lolos tanpa membuktikan apa-apa, dan itu
  // harus tertulis di laporan, bukan tersamar jadi "lulus".
  const sidSeen = text.includes(sid);
  console.log(
    sidSeen
      ? `BUKTI   T9c  log merekam URL (sid ditemukan) dan tok-nya tidak ikut: T9b terbukti`
      : `KOSONG  T9c  sid tidak muncul di log — log ini tidak merekam URL, T9b lolos tapi belum terbukti`
  );
} else {
  console.log('SKIP  T9  set PC_LOG_FILE ke log wrangler dev untuk memeriksa isi log');
}

console.log(failed === 0 ? '\nsemua tes M0 lulus' : `\n${failed} tes gagal`);
process.exit(failed === 0 ? 0 : 1);
