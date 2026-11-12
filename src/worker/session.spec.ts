import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { MAX_MEMBERS } from '../shared/limits';
import worker from './index';
import { SessionDO } from './SessionDO';

// Bunuh-bisa spike: apakah Worker + DO + SQLite + rate limit benar-benar terpasang
// lewat wrangler.jsonc, dan apakah frame spike dijawab sesuai kontrak.
function req(url: string, init?: RequestInit) {
  return worker.fetch(new Request(url, init), env);
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

it('/health menjawab ok', async () => {
  const res = await req('https://example.com/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, proto: 1 });
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
  const first = JSON.parse(sent[0] ?? '{}');
  const again = JSON.parse(sent[1] ?? '{}');
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
  const codes = sent.map((s) => JSON.parse(s).t);
  expect(codes.filter((c) => c === 'welcome').length).toBe(MAX_MEMBERS + 1);
  expect(codes.filter((c) => c === 'error').length).toBe(1);
  expect(JSON.parse(sent[MAX_MEMBERS] ?? '{}')).toMatchObject({ code: 'FULL' });
  expect(JSON.parse(sent[MAX_MEMBERS + 1] ?? '{}')).toMatchObject({ t: 'welcome', members: MAX_MEMBERS });
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
