import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import worker from './index';

// Ronde M3a #5 (2026-11-18) — dua sifat otoritas yang belum dipagari tes repo mana pun.
// Peta lengkapnya ada di README bagian ronde #5: I3/I4/I5 probe pemeriksa SUDAH dipagari
// (`session.spec.ts:515`, `eviction.spec.ts:78`, `session.spec.ts:473`); yang kosong cuma dua:
//   P1 = `start`/`stop` dari peniru ber-`did` pemimpin tanpa `lk` (tes lama cuma menguji `tempo`);
//   P2 = socket pemimpin yang `hello` ulang TANPA `lk` harus turun otoritasnya, dan `claim`
//        ber-`lk` harus menjadi jalan pulih yang nyata (tes lama cuma menguji arah naik).
// Ditulis ulang dengan byte saya sendiri, gaya `eviction.spec.ts`: semua assertion membaca
// JENDELA frame sesudah indeks diambil (`nungguDalam`/`sejak`), bukan riwayat dari indeks 0.

type CfSocket = WebSocket & { accept(): void };

const json = (f: string) => JSON.parse(f) as Record<string, unknown>;

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
  const ws = (res as unknown as { webSocket?: WebSocket }).webSocket as CfSocket;
  ws.accept();
  const frames: string[] = [];
  ws.addEventListener('message', (ev) => {
    frames.push(String(ev.data));
  });
  const nungguDalam = async (dari: number, pred: (f: Record<string, unknown>) => boolean, ms = 3000) => {
    for (let i = 0; i < ms / 10; i++) {
      const hit = frames.slice(dari).map(json).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  const tenang = async (ms = 300) => {
    await new Promise((r) => setTimeout(r, ms));
  };
  return {
    ws,
    frames,
    kirim: (f: unknown) => ws.send(JSON.stringify(f)),
    nungguDalam,
    tenang,
    sejak: (n: number) => frames.slice(n).map(json),
  };
}

const kerangka = (baru: Record<string, unknown>[]) => JSON.stringify(baru.filter((f) => f.t === 'error' || f.t === 'state'));

it('P1 — peniru ber-did pemimpin tanpa lk: start dan stop ditolak, tanpa satu siaran pun', async () => {
  const { sid, lk } = await lahir('231');
  const pemimpin = await buka(sid);
  pemimpin.kirim({ t: 'hello', sid, did: 'lead0031', lk });
  expect(await pemimpin.nungguDalam(0, (f) => f.t === 'welcome'), 'hello berkunci harus diterima').not.toBeNull();

  const peniru = await buka(sid);
  peniru.kirim({ t: 'hello', sid, did: 'lead0031' });
  expect(await pemimpin.nungguDalam(0, (f) => f.t === 'state' && f.members === 2), 'peniru harus terlihat sebagai kursi kedua').not.toBeNull();

  // Lagu harus SEDANG JALAN supaya `stop` punya sesuatu untuk diubah: `apply()` diam kalau
  // keadaan tidak berubah, jadi `stop` saat sudah berhenti memang tidak menyiarkan apa pun —
  // no-op yang benar, bukan penolakan. Tanpa kontrol ini assertion "nol siaran" bisa lulus vacuous.
  const dasarStart = pemimpin.frames.length;
  pemimpin.kirim({ t: 'start' });
  expect(await pemimpin.nungguDalam(dasarStart, (f) => f.t === 'state' && f.running === true), 'kontrol: pemimpin sah harus bisa start').not.toBeNull();

  for (const t of ['start', 'stop'] as const) {
    const dasarP = pemimpin.frames.length;
    const dasarX = peniru.frames.length;
    peniru.kirim({ t });
    const jawab = await peniru.nungguDalam(dasarX, (f) => f.t === 'error' || f.t === 'state');
    await pemimpin.tenang();
    expect(jawab && jawab.code, `${t} dari peniru harus dijawab NOT_LEADER, dapat ${JSON.stringify(jawab)}`).toBe('NOT_LEADER');
    expect(peniru.sejak(dasarX).filter((f) => f.t === 'state').length, `${t} dari peniru tidak boleh menyiarkan apa pun ke peniru`).toBe(0);
    expect(pemimpin.sejak(dasarP).filter((f) => f.t === 'state').length, `${t} dari peniru tidak boleh menyiarkan apa pun ke pemimpin, dapat ${kerangka(pemimpin.sejak(dasarP))}`).toBe(0);
  }

  // Jalan keluar yang sah tetap terbuka: pemimpin masih bisa stop sesudah dua penolakan itu.
  const dasar = pemimpin.frames.length;
  pemimpin.kirim({ t: 'stop' });
  expect(await pemimpin.nungguDalam(dasar, (f) => f.t === 'state' && f.running === false), 'pemimpin sah harus masih bisa stop').not.toBeNull();
  pemimpin.ws.close();
  peniru.ws.close();
});

it('P2 — pemimpin hello ulang tanpa lk di socket yang sama: turun otoritas, claim memulihkan', async () => {
  const { sid, lk } = await lahir('232');
  const p = await buka(sid);
  p.kirim({ t: 'hello', sid, did: 'lead0032', lk });
  expect(await p.nungguDalam(0, (f) => f.t === 'welcome'), 'hello berkunci harus diterima').not.toBeNull();
  const dasarNaik = p.frames.length;
  p.kirim({ t: 'tempo', bpm: 140 });
  expect(await p.nungguDalam(dasarNaik, (f) => f.t === 'state' && f.bpm === 140), 'kontrol: hello berkunci harus berkuasa').not.toBeNull();

  // Perilaku klien sungguhan: `live.ts` cuma menempelkan `lk` kalau target punya. HP pemimpin
  // yang membuka lewat tautan join mengirim hello tanpa lk di socket yang sama -> flag harus
  // turun. Kursinya tidak boleh dihitung dua: attachment sudah ada, baris member sudah ada.
  const dasarKursi = p.frames.length;
  p.kirim({ t: 'hello', sid, did: 'lead0032' });
  const w = await p.nungguDalam(dasarKursi, (f) => f.t === 'welcome');
  expect(w && w.members, 'hello ulang di socket yang sama tidak boleh menambah kursi').toBe(1);
  const dasar = p.frames.length;
  p.kirim({ t: 'tempo', bpm: 150 });
  const jawab = await p.nungguDalam(dasar, (f) => f.t === 'error' || f.t === 'state');
  expect(jawab && jawab.code, 'hello tanpa lk harus menurunkan otoritas di socket yang sama (S8-b)').toBe('NOT_LEADER');

  // Jalan pulih yang dijanjikan layar ("Ambil kendali"): claim ber-lk, diverifikasi ulang.
  const dasar2 = p.frames.length;
  p.kirim({ t: 'claim', lk });
  const pulih = await p.nungguDalam(dasar2, (f) => f.t === 'error' || f.t === 'state');
  expect(pulih && pulih.t, `claim ber-lk harus memulihkan kendali, dapat ${JSON.stringify(pulih)}`).toBe('state');
  const dasar3 = p.frames.length;
  p.kirim({ t: 'tempo', bpm: 160 });
  expect(await p.nungguDalam(dasar3, (f) => f.t === 'state' && f.bpm === 160), 'sesudah claim, tempo harus diterima lagi').not.toBeNull();
  p.ws.close();
});