import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
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
