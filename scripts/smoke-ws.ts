// Verifikasi jalur socket asli: Worker -> Durable Object -> hibernation handler.
// Jalankan setelah `npm run dev:worker`:  npx tsx scripts/smoke-ws.ts
// Ini membuktikan pipa WS jalan; angka RTT di localhost BUKAN hasil pengukuran jaringan
// (itu baru terbukti dari HP di lapangan lewat halaman /spike).
import { genDid, genSid } from '../src/shared/ids';
import { estimateOffset, toSample, type Sample, type Stamps } from '../src/app/sync/offset';

const BASE = process.env['PC_BASE_URL'] ?? 'http://127.0.0.1:8787';
const PINGS = 10;

const res = await fetch(`${BASE}/create`, { method: 'POST' });
const created = (await res.json()) as { sid?: string; wsPath?: string; error?: string };
if (typeof created.sid !== 'string' || typeof created.wsPath !== 'string') {
  throw new Error(`/create gagal: ${res.status} ${JSON.stringify(created)}`);
}
const { sid, wsPath } = created;
console.log(`sid=${sid}`);

const wsUrl = `${BASE.replace(/^http/, 'ws')}${wsPath}`;
const ws = new WebSocket(wsUrl);
const samples: Sample[] = [];
let rejected = 0;
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
  // Sampel dibuang kalau RTT-nya <= 0. Di localhost ini nyata terjadi: resolusi Date.now()
  // 1 ms, jadi satu perjalanan yang muat dalam satu milidetik menghasilkan RTT 0 atau negatif.
  // Angka yang dibuang harus tetap kelihatan supaya hal yang sama ketahuan di lapangan.
  if (!s) {
    rejected++;
    console.log(`ping ${frame.nonce}: dibuang (rtt=${(st.t4 - st.t1 - (st.t3 - st.t2)).toFixed(2)}ms)`);
    waiters.get(frame.nonce)?.();
    return;
  }
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

// Banjir create + sid palsu tanpa token diuji di scripts/attack.ts (T5), bukan di sini.

// sid kedua harus ditolak: alfabet hanya 32 simbol, tanpa I O 0 1.
const bad = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?sid=${genSid()}!&tok=${'0'.repeat(64)}`);
const badStatus = await new Promise<string>((resolve) => {
  bad.addEventListener('error', () => resolve('ditolak'), { once: true });
  bad.addEventListener('open', () => {
    bad.close();
    resolve('SEHARUSNYA DITOLAK');
  }, { once: true });
});
console.log(`sid cacat → ${badStatus}`);

console.log(
  `sampel=${samples.length}/${PINGS} dibuang=${rejected} offset=${estimateOffset(samples).toFixed(2)}ms`
);
ws.close(1000, 'selesai');
