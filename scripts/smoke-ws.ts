// Verifikasi jalur socket asli: Worker -> Durable Object -> hibernation handler.
// Jalankan setelah `npm run dev:worker`:  npx tsx scripts/smoke-ws.ts
// Ini membuktikan pipa WS jalan; angka RTT di localhost BUKAN hasil pengukuran jaringan
// (itu baru terbukti dari HP di lapangan lewat halaman /spike).
import { genDid, genSid } from '../src/shared/ids';
import { estimateOffset, toSample, type Sample, type Stamps } from '../src/app/sync/offset';

const BASE = process.env['PC_BASE_URL'] ?? 'http://127.0.0.1:8787';
const PINGS = 10;

const res = await fetch(`${BASE}/create`, { method: 'POST' });
const { sid } = (await res.json()) as { sid: string };
if (typeof sid !== 'string') throw new Error(`/create gagal: ${res.status}`);
console.log(`sid=${sid}`);

const wsUrl = `${BASE.replace(/^http/, 'ws')}/ws?sid=${sid}`;
const ws = new WebSocket(wsUrl);
const samples: Sample[] = [];
const waiters = new Map<number, () => void>();

ws.addEventListener('message', (ev) => {
  const frame = JSON.parse(String(ev.data)) as Record<string, unknown>;
  if (frame.t === 'welcome') {
    console.log(`welcome members=${String(frame.members)} rowsWritten=${String(frame.rowsWritten)}`);
    return;
  }
  if (frame.t !== 'pong' || typeof frame.nonce !== 'number') {
    console.log(`frame tak terduga: ${String(ev.data)}`);
    return;
  }
  const st: Stamps = {
    t1: Number(frame.t1),
    t2: Number(frame.t2),
    t3: Number(frame.t3),
    t4: Date.now(),
  };
  const s = toSample(st);
  samples.push(s);
  console.log(`ping ${frame.nonce}: rtt=${s.rttMs.toFixed(2)}ms offset=${s.offsetMs.toFixed(2)}ms`);
  waiters.get(frame.nonce)?.();
});

await new Promise<void>((resolve, reject) => {
  ws.addEventListener('open', () => resolve(), { once: true });
  ws.addEventListener('error', () => reject(new Error('gagal connect WebSocket')), { once: true });
});

ws.send(JSON.stringify({ t: 'hello', sid, did: genDid() }));

for (let i = 0; i < PINGS; i++) {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      waiters.delete(i);
      console.log(`ping ${i} hilang`);
      resolve();
    }, 1500);
    waiters.set(i, () => {
      clearTimeout(timeout);
      waiters.delete(i);
      resolve();
    });
    ws.send(JSON.stringify({ t: 'ping', nonce: i, t1: Date.now() }));
  });
  await new Promise((r) => setTimeout(r, 100));
}

// sid kedua harus ditolak: alfabet hanya 32 simbol, tanpa I O 0 1.
const bad = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?sid=${genSid()}!`);
const badStatus = await new Promise<string>((resolve) => {
  bad.addEventListener('error', () => resolve('ditolak'), { once: true });
  bad.addEventListener('open', () => {
    bad.close();
    resolve('SEHARUSNYA DITOLAK');
  }, { once: true });
});
console.log(`sid cacat → ${badStatus}`);

console.log(`sampel=${samples.length}/${PINGS} offset=${estimateOffset(samples).toFixed(2)}ms`);
ws.close(1000, 'selesai');
