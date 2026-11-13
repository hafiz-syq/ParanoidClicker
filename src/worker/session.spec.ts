import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { isSid } from '../shared/ids';
import { MAX_MEMBERS } from '../shared/limits';
import worker from './index';
import { SessionDO } from './SessionDO';

// Bunuh-bisa spike: apakah Worker + DO + SQLite + rate limit benar-benar terpasang
// lewat wrangler.jsonc, dan apakah frame spike dijawab sesuai kontrak.
function req(url: string, init?: RequestInit) {
  return worker.fetch(new Request(url, init), env);
}

function reqTanpaKunci(url: string, init?: RequestInit) {
  return worker.fetch(new Request(url, init), { ...env, SESSION_SIGNING_KEY: '' });
}

function fakeSocket(sent: string[]) {
  return { send: (m: string) => void sent.push(m), close: () => undefined } as unknown as WebSocket;
}

function stubFor(sid: string) {
  return env.SESSION.get(env.SESSION.idFromName(sid));
}

// Rate limit per IP, jadi tiap tes pakai alamat sendiri supaya tidak saling mengunci.
function ip(n: string) {
  return { 'CF-Connecting-IP': `203.0.113.${n}` };
}

it('/ws menolak sid yang tidak pernah lahir dari /create', async () => {
  const upgrade = { headers: { ...ip('7'), Upgrade: 'websocket' } };
  const cases = ['https://example.com/ws?sid=ABCD', `https://example.com/ws?sid=ABCD&tok=${'a'.repeat(64)}`];
  for (const url of cases) {
    expect((await req(url, upgrade)).status).toBe(403);
  }
  // tok bukan-hex / kependekan harus 403, bukan 500: parseHex menolak sebelum verify dipanggil.
  expect((await req('https://example.com/ws?sid=ABCD&tok=zz', upgrade)).status).toBe(403);
});

it('/create lalu /ws dengan tok yang sah membuka socket', async () => {
  const created = await req('https://example.com/create', { method: 'POST', headers: ip('8') });
  const { wsPath } = (await created.json()) as { wsPath: string };
  const res = await req(`https://example.com${wsPath}`, { headers: { ...ip('8'), Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
});

// Kunci kosong = token apa pun yang kita mint bisa dihitung ulang oleh siapa pun, jadi
// satu-satunya jawaban yang benar adalah menolak, bukan melayani sesi tanpa gerbang.
it('SESSION_SIGNING_KEY kosong membuat /create dan /ws gagal tertutup', async () => {
  const created = await reqTanpaKunci('https://example.com/create', { method: 'POST', headers: ip('9') });
  expect(created.status).toBe(500);
  expect(await created.json()).toMatchObject({ error: 'NO_KEY' });
  const ws = await reqTanpaKunci(`https://example.com/ws?sid=ABCD&tok=${'a'.repeat(64)}`, {
    headers: { ...ip('9'), Upgrade: 'websocket' },
  });
  // 500, bukan 101: tanpa kunci tidak ada satu pun DO yang boleh berpindah tangan.
  expect(ws.status).toBe(500);
  const health = (await (await reqTanpaKunci('https://example.com/health')).json()) as object;
  expect(health).toMatchObject({ ok: true, keyPresent: false });
});

it('/health menjawab ok', async () => {
  const res = await req('https://example.com/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, proto: 2 });
});

it('/ws menolak tanpa Upgrade dan sid cacat', async () => {
  // Gerbang Upgrade lebih dulu: permintaan tanpa header itu tidak pernah menyentuh DO.
  expect((await req('https://example.com/ws?sid=ABCD')).status).toBe(426);
  const upgrade = { headers: { Upgrade: 'websocket' } };
  expect((await req('https://example.com/ws?sid=AB%21D', upgrade)).status).toBe(400);
});

it('/create menolak GET', async () => {
  expect((await req('https://example.com/create')).status).toBe(405);
});

it('hello menulis satu baris member dan menjawab welcome', async () => {
  const sent: string[] = [];
  await runInDurableObject(stubFor('ABCD'), async (instance: SessionDO) => {
    await instance.webSocketMessage(fakeSocket(sent), JSON.stringify({ t: 'hello', sid: 'ABCD', did: 'deadbeef' }));
  });
  const frame = JSON.parse(sent[0] ?? '{}') as Record<string, unknown>;
  // rowsWritten 2, bukan 1: baris tabel + entri indeks PRIMARY KEY dihitung terpisah,
  // jadi kuota "rows written" gratis harus dihitung 2x per orang yang masuk.
  expect(frame).toMatchObject({ t: 'welcome', sid: 'ABCD', members: 1, rowsWritten: 2 });
});

it('hello ulang dari HP yang sama tidak membayar kuota tulis dua kali', async () => {
  const sent: string[] = [];
  await runInDurableObject(stubFor('RPT9'), async (instance: SessionDO) => {
    const frame = JSON.stringify({ t: 'hello', sid: 'RPT9', did: 'cafe0001' });
    await instance.webSocketMessage(fakeSocket(sent), frame);
    await instance.webSocketMessage(fakeSocket(sent), frame);
  });
  // Setiap welcome sekarang diikuti satu frame state, jadi diambil yang bertipe welcome
  // saja — indeks mentah akan pecah setiap kali ada frame baru.
  const welcomes = sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'welcome');
  const [first, again] = welcomes;
  expect(first).toMatchObject({ members: 1, rowsWritten: 2 });
  // OR IGNORE: INSERT-nya tidak menulis apa pun, dan jumlah member tidak naik.
  expect(again).toMatchObject({ t: 'welcome', members: 1, rowsWritten: 0 });
});

it('hello ke-13 dari device baru ditolak FULL', async () => {
  const sent: string[] = [];
  await runInDurableObject(stubFor('FULL'), async (instance: SessionDO) => {
    const sock = fakeSocket(sent);
    for (let i = 0; i < MAX_MEMBERS; i++) {
      await instance.webSocketMessage(sock, JSON.stringify({ t: 'hello', sid: 'FULL', did: `member${i}` }));
    }
    await instance.webSocketMessage(sock, JSON.stringify({ t: 'hello', sid: 'FULL', did: 'memberX' }));
    // Yang sudah masuk tetap boleh hello ulang walau session sudah penuh.
    await instance.webSocketMessage(sock, JSON.stringify({ t: 'hello', sid: 'FULL', did: 'member0' }));
  });
  const parsed = sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  const welcomes = parsed.filter((f) => f.t === 'welcome');
  const errors = parsed.filter((f) => f.t === 'error');
  expect(welcomes.length).toBe(MAX_MEMBERS + 1);
  expect(errors.length).toBe(1);
  expect(errors[0]).toMatchObject({ code: 'FULL' });
  expect(welcomes[welcomes.length - 1]).toMatchObject({ t: 'welcome', members: MAX_MEMBERS });
});

it('ping dijawab pong dengan t2 dan t3 milik server', async () => {
  const sent: string[] = [];
  await runInDurableObject(stubFor('EFGH'), async (instance: SessionDO) => {
    await instance.webSocketMessage(fakeSocket(sent), JSON.stringify({ t: 'ping', nonce: 7, t1: 1234 }));
  });
  const frame = JSON.parse(sent[0] ?? '{}') as Record<string, unknown>;
  expect(frame.t).toBe('pong');
  expect(frame.nonce).toBe(7);
  expect(frame.t1).toBe(1234);
  expect(typeof frame.t2).toBe('number');
  expect(Number(frame.t3)).toBeGreaterThanOrEqual(Number(frame.t2));
});

it('frame kebesaran atau berkunci __proto__ ditolak sebelum disentuh logika', async () => {
  const sent: string[] = [];
  await runInDurableObject(stubFor('JKLM'), async (instance: SessionDO) => {
    await instance.webSocketMessage(fakeSocket(sent), JSON.stringify({ t: 'ping', nonce: 1, t1: 1, pad: 'x'.repeat(9000) }));
    await instance.webSocketMessage(fakeSocket(sent), '{"__proto__":{"comp":99999},"t":"ping"}');
    await instance.webSocketMessage(fakeSocket(sent), JSON.stringify({ t: 'ngawur' }));
  });
  expect(sent.map((s) => JSON.parse(s).code)).toEqual(['TOO_BIG', 'BAD_KEY', 'PROTO']);
});

// —— M1: keadaan tempo ——
//
// Broadcast hanya bisa dibuktikan lewat socket asli: ctx.getWebSockets() tidak pernah berisi
// fakeSocket, jadi tes di atas cuma menguji balasan langsung ke pengirim.
type CfSocket = WebSocket & { accept(): void };

interface Peer {
  ws: CfSocket;
  frames: string[];
  send(frame: unknown): void;
  until(count: number): Promise<string[]>;
}

async function openPeer(sid: string): Promise<Peer> {
  // Sid wajib lewat alfabet ids.ts (tanpa 0/1/I/O): sid cacat membuat hello dijawab PROTO,
  // dan tanpa penjaga ini tesnya menggantung sampai timeout vitest, bukan gagal jelas.
  if (!isSid(sid)) throw new Error(`sid '${sid}' bukan alfabet ids.ts`);
  const res = await stubFor(sid).fetch(new Request('https://example.com/ws', { headers: { Upgrade: 'websocket' } }));
  expect(res.status).toBe(101);
  const raw = (res as unknown as { webSocket?: WebSocket }).webSocket;
  if (!raw) throw new Error('DO mengembalikan Response tanpa .webSocket: Upgrade tidak diterima');
  const ws = raw as CfSocket;
  ws.accept();
  const frames: string[] = [];
  ws.addEventListener('message', (ev) => {
    frames.push(String(ev.data));
  });
  return {
    ws,
    frames,
    send: (frame) => ws.send(JSON.stringify(frame)),
    // Frame datang tidak serentak: yang ditunggu jumlahnya, bukan waktunya. Batasnya 200 ×
    // 5 ms supaya kemacetan nyata memunculkan pesan ini, bukan timeout vitest yang bisu.
    until: async (count) => {
      for (let tries = 0; frames.length < count && tries < 200; tries++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      if (frames.length < count) throw new Error(`baru ${frames.length} frame masuk, butuh ${count}`);
      return frames;
    },
  };
}

const body = (frame: string) => JSON.parse(frame) as Record<string, unknown>;
const statesOf = (frames: string[]) => frames.filter((f) => body(f).t === 'state').map(body);

it('hello dibalas welcome lalu state, supaya pengikut baru langsung sephase', async () => {
  const peer = await openPeer('TMPA');
  peer.send({ t: 'hello', sid: 'TMPA', did: 'dev1' });
  const frames = await peer.until(2);
  expect(body(frames[0]).t).toBe('welcome');
  // DO belum pernah melihat satu pun perubahan: keadaan idle, bukan kosong tanpa frame.
  expect(frames[1]).toBe('{"t":"state","bpm":120,"anchorMs":null,"running":false}');
  peer.ws.close();
});

it('start menyebarkan anchor yang sama persis ke semua socket terbuka', async () => {
  const a = await openPeer('TMPB');
  const b = await openPeer('TMPB');
  a.send({ t: 'hello', sid: 'TMPB', did: 'devA' });
  b.send({ t: 'hello', sid: 'TMPB', did: 'devB' });
  await a.until(2);
  await b.until(2);

  a.send({ t: 'start' });
  const framesA = await a.until(3);
  const framesB = await b.until(3);
  // Byte-identik: kalau dua HP menerima teks berbeda, ada dua versi kebenaran di ruangan.
  expect(framesA[2]).toBe(framesB[2]);
  const state = statesOf(framesA)[1];
  expect(state).toMatchObject({ t: 'state', bpm: 120, running: true });
  expect(Number(state.anchorMs)).toBeGreaterThan(Date.now());
  a.ws.close();
  b.ws.close();
});

it('tempo saat berjalan mendarat di batas grid lama, bukan di tengah beat', async () => {
  const peer = await openPeer('TMPC');
  peer.send({ t: 'hello', sid: 'TMPC', did: 'devC' });
  await peer.until(2);
  peer.send({ t: 'start' });
  await peer.until(3);
  const states = statesOf(peer.frames);
  expect(states[0]).toMatchObject({ running: false, anchorMs: null });
  const anchor = Number(states[1].anchorMs);
  expect(Number.isFinite(anchor)).toBe(true);

  peer.send({ t: 'tempo', bpm: 180 });
  const after = await peer.until(4);
  const state = statesOf(after)[2];
  expect(state).toMatchObject({ bpm: 180, running: true });
  // Grid lama 120 BPM = 500 ms persis, jadi batasnya bisa diuji tanpa pembulatan.
  const delta = Number(state.anchorMs) - anchor;
  expect(delta).toBeGreaterThanOrEqual(0);
  expect(delta % 500).toBe(0);
  peer.ws.close();
});

it('tempo cacat hanya menjawab pengirimnya, tidak menyentuh HP lain', async () => {
  const a = await openPeer('TMPD');
  const b = await openPeer('TMPD');
  a.send({ t: 'hello', sid: 'TMPD', did: 'devD' });
  b.send({ t: 'hello', sid: 'TMPD', did: 'devE' });
  await a.until(2);
  await b.until(2);

  const cacat = [137.5, 29, 301, '120', null];
  for (const bpm of cacat) a.send({ t: 'tempo', bpm });
  const framesA = await a.until(2 + cacat.length);
  expect(framesA.slice(2).map((f) => body(f).code)).toEqual(cacat.map(() => 'BAD_BPM'));
  // b diam-diam saja: tidak ada frame ketiga sama sekali.
  expect(b.frames.length).toBe(2);
  a.ws.close();
  b.ws.close();
});

it('tombol start yang ditekan dua kali tidak menulis dua kali', async () => {
  const peer = await openPeer('TMPE');
  peer.send({ t: 'hello', sid: 'TMPE', did: 'devF' });
  await peer.until(2);
  peer.send({ t: 'start' });
  await peer.until(3);
  peer.send({ t: 'start' });
  peer.send({ t: 'stop' });
  const last = await peer.until(4);
  expect(statesOf(last)[1]).toMatchObject({ running: true });
  expect(statesOf(last)[2]).toMatchObject({ running: false, anchorMs: null, bpm: 120 });
  // Jendela jeda, bukan hitungan: start ulang + stop bersama-sama hanya menghasilkan SATU
  // broadcast. Tanpa penjaga `cur.running`, frame kelima (anchor baru) menyusul di sini dan
  // semua HP melompat beberapa milidetik — itu yang membakar kuota tulis juga.
  await new Promise((r) => setTimeout(r, 60));
  expect(last.length).toBe(4);
  peer.ws.close();
});

it('tempo saat berhenti hanya mengubah bpm, grid baru lahir saat start', async () => {
  const peer = await openPeer('TMPF');
  peer.send({ t: 'hello', sid: 'TMPF', did: 'devG' });
  await peer.until(2);
  peer.send({ t: 'tempo', bpm: 90 });
  const stopped = await peer.until(3);
  expect(statesOf(stopped)[1]).toMatchObject({ bpm: 90, running: false, anchorMs: null });
  peer.send({ t: 'start' });
  const started = await peer.until(4);
  expect(statesOf(started)[2]).toMatchObject({ bpm: 90, running: true });
  peer.ws.close();
});
