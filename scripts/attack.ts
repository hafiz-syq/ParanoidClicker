// Tes serangan otomatis untuk spike M0: §15 T5, T6, T7, T9.
// Jalankan setelah `npm run dev:worker` (atau terhadap deployment sendiri):
//   npx tsx scripts/attack.ts
//   PC_BASE_URL=https://paranoidclick.<akun>.workers.dev PC_LOG_FILE=/tmp/pc-dev.log npx tsx scripts/attack.ts
// BATAS: hanya boleh ke URL milik sendiri. Tidak ada permintaan ke pihak ketiga di sini.
// Kerangka T1/T2/T3/T4/T8/T10/T11 ikut baris ini nanti, begitu cmd.* dan join ada.
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { genSid } from '../src/shared/ids';

const BASE = process.env['PC_BASE_URL'] ?? 'http://127.0.0.1:8787';
const LOG = process.env['PC_LOG_FILE'] ?? '';

// Kunci rate limiter diambil dari CF-Connecting-IP. Di produksi header itu ditulis ulang oleh
// edge Cloudflare, jadi klien tidak bisa memalsukannya; di lokal header ini bebas dipakai, dan
// tiap sesi uji mengambil alamat TEST-NET acak supaya tes yang beruntun tidak saling mengunci.
const testIp = () => `198.51.100.${10 + Math.floor(Math.random() * 200)}`;
const ownIp = testIp();

// fetch (undici) menolak header Upgrade, jadi handshake palsu harus lewat node:http.
function statusWithUpgrade(path: string, ip: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE);
    const req = request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        method: 'GET',
        path,
        headers: { 'CF-Connecting-IP': ip, Connection: 'Upgrade', Upgrade: 'websocket' },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
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
const created = (await (
  await fetch(`${BASE}/create`, { method: 'POST', headers: { 'CF-Connecting-IP': ownIp } })
).json()) as {
  sid?: string;
  token?: string;
  wsPath?: string;
};
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

// Kirim satu payload di socket baru, kumpulkan frame yang pulang dalam 700 ms.
function bomb(payload: string): Promise<Probe> {
  return new Promise<Probe>((resolve) => {
    const ws = new WebSocket(wsUrl(wsPath));
    const raw: string[] = [];
    let settled = false;
    const finish = (closeCode: number) => {
      if (settled) return;
      settled = true;
      resolve({ codes: raw.map(codeOf), closeCode });
    };
    ws.addEventListener('message', (ev) => raw.push(String(ev.data)));
    ws.addEventListener('close', (ev) => finish(ev.code));
    ws.addEventListener('error', () => finish(0));
    ws.addEventListener('open', () => ws.send(payload), { once: true });
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'selesai');
      else finish(0);
    }, 700);
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
  statuses.push((await fetch(`${BASE}/create`, { method: 'POST', headers: { 'CF-Connecting-IP': floodIp } })).status);
}
const allowed = statuses.filter((s) => s === 200).length;
const throttled = statuses.filter((s) => s === 429).length;
check('T5a', allowed <= 3 && throttled >= 27, `30 create dari 1 IP → ${allowed} lulus, ${throttled} 429`);

// Sid yang bentuknya sempurna tapi tidak pernah keluar dari /create: dulu ini pintu
// belakangnya (1 DO SQLite per tebakan), sekarang harus 403 sebelum env.SESSION disentuh.
const forged: number[] = [];
for (let i = 0; i < 30; i++) {
  forged.push(await statusWithUpgrade(`/ws?sid=${genSid()}&tok=${'a'.repeat(64)}`, testIp()));
}
check('T5b', forged.every((s) => s === 403), `30 sid palsu → status unik ${[...new Set(forged)].join(',')}`);

console.log('\n--- T9: jejak di log ---');

if (LOG && existsSync(LOG)) {
  const text = readFileSync(LOG, 'utf8');
  check('T9a', !text.includes('AAAA'), 'isi payload tidak tertulis di log dev');
  check('T9b', !text.includes(created.token ?? '§'), `token sesi tidak tertulis di log (${text.length} byte diperiksa)`);
} else {
  console.log('SKIP  T9  set PC_LOG_FILE ke log wrangler dev untuk memeriksa isi log');
}

console.log(failed === 0 ? '\nsemua tes M0 lulus' : `\n${failed} tes gagal`);
process.exit(failed === 0 ? 0 : 1);
