import { env, evictDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import worker from './index';

// Ronde M3a #2 (2026-11-17) — TEMUAN 1: otoritas pemimpin hilang sesudah DO di-evict.
//
// `SessionDO.peers` adalah `Map<WebSocket, Peer>` di memori saja, sementara `fetch()` memakai
// Hibernation API (`ctx.acceptWebSocket`). Sesudah DO tidur dan dibangun ulang, runtime
// memanggil handler dengan objek WebSocket BARU yang tidak ada di Map itu — jadi `assertLeader`
// dan `claim` menjawab NOT_LEADER bahkan untuk `lk` yang sah. UI menampilkan tombol
// "Ambil kendali" (`ClickRoom.tsx:318` → `live.ts:151` → frame `claim`) sebagai satu-satunya
// jalan pulang ke podium; jalan itu terukur buntu.
//
// A dan B menuntut KEADAAN YANG BENAR, jadi keduanya merah di `33c2342` — itu bukti RED-nya.
// C = kontrol positif: jalur `hello` ulang memang sudah bekerja (dan kursi tidak boleh rusak).
// D = pagarnya: perbaikan tidak boleh mengubah ruangan jadi "siapa pun boleh memerintah".

type CfSocket = WebSocket & { accept(): void };

const json = (f: string) => JSON.parse(f) as Record<string, unknown>;

/** Rate limit /create per IP — tiap tes pakai alamat sendiri supaya tidak saling mengunci. */
function ip(n: string) {
  return { 'CF-Connecting-IP': `203.0.113.${n}` };
}

async function lahir(n: string): Promise<{ sid: string; lk: string }> {
  const res = await worker.fetch(new Request('https://example.com/create', { method: 'POST', headers: ip(n) }), env);
  const body = (await res.json()) as { sid?: unknown; leaderKey?: unknown };
  if (typeof body.sid !== 'string' || typeof body.leaderKey !== 'string') {
    throw new Error(`/create belum mencetak leaderKey (dapat ${JSON.stringify(Object.keys(body))})`);
  }
  return { sid: body.sid, lk: body.leaderKey };
}

async function buka(sid: string) {
  const stub = env.SESSION.get(env.SESSION.idFromName(sid));
  const res = await stub.fetch(new Request('https://example.com/ws', { headers: { Upgrade: 'websocket' } }));
  expect(res.status).toBe(101);
  const raw = (res as unknown as { webSocket?: WebSocket }).webSocket;
  if (!raw) throw new Error('DO mengembalikan Response tanpa .webSocket: Upgrade tidak diterima');
  const ws = raw as CfSocket;
  ws.accept();
  const frames: string[] = [];
  ws.addEventListener('message', (ev) => {
    frames.push(String(ev.data));
  });
  // Evict + hibernasi tidak serentak: yang ditunggu adalah frame yang cocok, bukan jam dinding.
  const cari = async (pred: (f: Record<string, unknown>) => boolean, ms = 3000) => {
    for (let i = 0; i < ms / 10; i++) {
      const hit = frames.map(json).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  const tenang = async (ms = 1200) => {
    await new Promise((r) => setTimeout(r, ms));
  };
  const sejak = (n: number) => frames.slice(n).map(json);
  return { stub, ws, frames, kirim: (f: unknown) => ws.send(JSON.stringify(f)), cari, tenang, sejak };
}

const kerangka = (baru: Record<string, unknown>[]) => JSON.stringify(baru.filter((f) => f.t === 'error' || f.t === 'state'));

it('A — pemimpin sah masih boleh mengubah tempo sesudah DO di-evict', async () => {
  const { sid, lk } = await lahir('201');
  const p = await buka(sid);
  p.kirim({ t: 'hello', sid, did: 'lead0001', lk });
  expect(await p.cari((f) => f.t === 'welcome'), 'hello berkunci harus diterima sebelum serangan').not.toBeNull();

  // Penjaga salah sasaran: kalau 140 saja tidak diterima SEBELUM evict, yang merah bukan
  // hibernasinya tapi tesnya.
  p.kirim({ t: 'tempo', bpm: 140 });
  expect(await p.cari((f) => f.t === 'state' && f.bpm === 140), 'tempo 140 harus diterima SEBELUM evict').not.toBeNull();

  await evictDurableObject(p.stub);
  const dasar = p.frames.length;
  p.kirim({ t: 'tempo', bpm: 150 });
  await p.tenang();
  const baru = p.sejak(dasar);
  expect(baru.filter((f) => f.t === 'error'), `pemimpin sah tidak boleh ditolak sesudah hibernasi, dapat ${kerangka(baru)}`).toEqual([]);
  expect(baru.filter((f) => f.t === 'state' && f.bpm === 150).length, `state bpm 150 harus disiarkan, dapat ${kerangka(baru)}`).toBeGreaterThan(0);
  p.ws.close();
});

it('B — claim ber-lk sah menyiarkan state sesudah DO di-evict (jalur tombol "Ambil kendali")', async () => {
  const { sid, lk } = await lahir('202');
  const p = await buka(sid);
  p.kirim({ t: 'hello', sid, did: 'lead0002', lk });
  await p.cari((f) => f.t === 'welcome');

  await evictDurableObject(p.stub);
  const dasar = p.frames.length;
  p.kirim({ t: 'claim', lk });
  await p.tenang();
  const baru = p.sejak(dasar);
  expect(baru.filter((f) => f.t === 'error'), `lk sah tidak boleh dijawab ${JSON.stringify(baru.filter((f) => f.t === 'error'))}`).toEqual([]);
  expect(baru.filter((f) => f.t === 'state').length, `claim yang sah harus menyiarkan state, dapat ${kerangka(baru)}`).toBeGreaterThan(0);
  p.ws.close();
});

it('C — kontrol positif: hello ulang sesudah evict memulihkan kendali dan kursi tetap benar', async () => {
  const { sid, lk } = await lahir('203');
  const p = await buka(sid);
  p.kirim({ t: 'hello', sid, did: 'lead0003', lk });
  await p.cari((f) => f.t === 'welcome');
  p.kirim({ t: 'tempo', bpm: 140 });
  await p.cari((f) => f.t === 'state' && f.bpm === 140);
  const q = await buka(sid);
  q.kirim({ t: 'hello', sid, did: 'follower3' });
  await p.cari((f) => f.t === 'state' && f.members === 2);

  await evictDurableObject(p.stub);
  p.kirim({ t: 'hello', sid, did: 'lead0003', lk });
  // `welcome` adalah jawaban dari socket yang SUDAH dikenal DO sebelum evict: kursinya harus
  // tetap 2 — getWebSockets() bertahan lintas hibernasi, dan itulah alasan angka kursi tidak
  // ikut rusak waktu otoritas hilang.
  const welcome = await p.cari((f) => f.t === 'welcome' && f.members === 2);
  expect(welcome, 'kursi harus tetap 2 sesudah evict').not.toBeNull();

  const dasar = p.frames.length;
  p.kirim({ t: 'tempo', bpm: 160 });
  expect(await p.cari((f) => f.t === 'state' && f.bpm === 160), 'hello ulang ber-lk harus memulihkan kendali').not.toBeNull();
  expect(p.sejak(dasar).filter((f) => f.t === 'error'), 'setelah hello ulang tidak boleh ada penolakan').toEqual([]);
  p.ws.close();
  q.ws.close();
});

it('D — fail-closed: pengikut tanpa lk tetap NOT_LEADER sesudah evict, di tempo maupun claim', async () => {
  const { sid, lk } = await lahir('204');
  const pemimpin = await buka(sid);
  pemimpin.kirim({ t: 'hello', sid, did: 'lead0004', lk });
  await pemimpin.cari((f) => f.t === 'welcome');
  const pengikut = await buka(sid);
  pengikut.kirim({ t: 'hello', sid, did: 'ikut0004' });
  await pemimpin.cari((f) => f.t === 'state' && f.members === 2);

  await evictDurableObject(pemimpin.stub);

  pengikut.kirim({ t: 'tempo', bpm: 180 });
  expect(await pengikut.cari((f) => f.t === 'error' && f.code === 'NOT_LEADER'), 'tempo dari pengikut harus tetap ditolak').not.toBeNull();
  pengikut.kirim({ t: 'claim' });
  const jawab = await pengikut.cari((f) => f.t === 'error' && f.code === 'NOT_LEADER', 3000);
  expect(jawab, 'claim tanpa lk harus tetap ditolak').not.toBeNull();
  expect(pengikut.frames.map(json).filter((f) => f.t === 'state' && f.bpm === 180), 'bpm 180 tidak boleh pernah disiarkan').toEqual([]);

  pemimpin.ws.close();
  pengikut.ws.close();
});
