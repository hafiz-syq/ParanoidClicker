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

// lk diambil dari /create sungguhan, bukan dari HMAC yang dihitung ulang di file tes: yang
// harus dibuktikan adalah kunci yang dicetak rute itu memang bisa dipakai lagi oleh DO.
async function mintPemimpin(n: string): Promise<{ sid: string; lk: string }> {
  const res = await req('https://example.com/create', { method: 'POST', headers: ip(n) });
  const body = (await res.json()) as { sid?: unknown; leaderKey?: unknown };
  if (typeof body.sid !== 'string' || typeof body.leaderKey !== 'string') {
    throw new Error(`/create belum mencetak leaderKey (dapat ${JSON.stringify(Object.keys(body))})`);
  }
  return { sid: body.sid, lk: body.leaderKey };
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

// —— §6.2: kursinya socket hidup, bukan sejarah di tabel `member` ——
//
// Tiga tes di bawah ini dulunya memakai fakeSocket di dalam runInDurableObject: socket itu
// tidak pernah ada di ctx.getWebSockets(), jadi angka `members` yang diuji adalah COUNT(*)
// SQLite. Setelah §6.2 angka itu adalah kursi, maka socketnya harus nyata — dan harus bisa
// ditutup lagi, karena justru pelepasan kursi itu yang baru mau diuji.

it('hello menulis satu baris member dan menjawab welcome', async () => {
  const peer = await openPeer('ABCD');
  peer.send({ t: 'hello', sid: 'ABCD', did: 'deadbeef' });
  const frames = await peer.until(2);
  // rowsWritten 2, bukan 1: baris tabel + entri indeks PRIMARY KEY dihitung terpisah,
  // jadi kuota "rows written" gratis harus dihitung 2x per orang yang masuk. Tabel `member`
  // TETAP mengukur ini walau kursi sudah pindah ke socket (§4 butir 2b).
  expect(body(frames[0]!)).toMatchObject({ t: 'welcome', sid: 'ABCD', members: 1, rowsWritten: 2 });
  peer.ws.close();
});

it('hello ulang dari HP yang sama tidak membayar kuota tulis dua kali', async () => {
  const peer = await openPeer('RPT9');
  const hello = { t: 'hello', sid: 'RPT9', did: 'cafe0001' };
  peer.send(hello);
  peer.send(hello);
  // welcome + state, dua kali: frame state ikut dihitung supaya `until` tidak menggantung.
  const welcomes = (await peer.until(4)).map(body).filter((f) => f.t === 'welcome');
  expect(welcomes[0]).toMatchObject({ members: 1, rowsWritten: 2 });
  // OR IGNORE: INSERT-nya tidak menulis apa pun, dan socketnya sudah terhitung sendiri.
  expect(welcomes[1]).toMatchObject({ t: 'welcome', members: 1, rowsWritten: 0 });
  peer.ws.close();
});

it('ke-13 ditolak FULL, dan kursi dari socket yang ditutup bisa dipakai lagi', async () => {
  const peers: Peer[] = [];
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const p = await openPeer('FULL');
    p.send({ t: 'hello', sid: 'FULL', did: `member${i}` });
    peers.push(p);
  }
  await peers[0]!.untilStates(MAX_MEMBERS);

  // Yang sudah masuk tetap boleh hello ulang walau ruangan penuh (reconnect, tab bangun).
  const dasar = peers[0]!.frames.length;
  peers[0]!.send({ t: 'hello', sid: 'FULL', did: 'member0' });
  const ulang = (await peers[0]!.until(dasar + 1)).map(body);
  expect(ulang.filter((f) => f.t === 'welcome').at(-1)).toMatchObject({ members: MAX_MEMBERS, rowsWritten: 0 });

  const penolak = await openPeer('FULL');
  const sebelumPenuh = peers[0]!.frames.length;
  penolak.send({ t: 'hello', sid: 'FULL', did: 'memberX' });
  await penolak.until(1);
  expect(body(penolak.frames[0]!)).toMatchObject({ t: 'error', code: 'FULL' });
  await new Promise((r) => setTimeout(r, 40));
  expect(peers[0]!.frames.length).toBe(sebelumPenuh);

  // Konsekuensi socket MENTAH yang tercatat di §4 butir 2b: yang ditolak FULL masih
  // memegang socketnya, jadi angka berikutnya 13 walau yang terdaftar cuma 12.
  peers[0]!.send({ t: 'hello', sid: 'FULL', did: 'member0' });
  const hantu = (await peers[0]!.until(sebelumPenuh + 1)).map(body);
  expect(hantu.filter((f) => f.t === 'welcome').at(-1)).toMatchObject({ members: MAX_MEMBERS + 1 });

  // Satu HP pulang → kursi lepas → yang tadi ditolak boleh masuk. Dasar lama (COUNT(*) FROM
  // member) tidak bisa melakukan ini: FULL itu permanen sampai DO di-evict.
  const pulang = peers[MAX_MEMBERS - 1]!;
  pulang.ws.close();
  const turun = await peers[0]!.untilStates(MAX_MEMBERS + 3);
  expect(body(turun.at(-1)!)).toMatchObject({ t: 'state', members: MAX_MEMBERS });
  penolak.send({ t: 'hello', sid: 'FULL', did: 'memberX' });
  const masuk = (await penolak.until(3)).map(body).filter((f) => f.t === 'welcome');
  expect(masuk).toHaveLength(1);
  expect(masuk[0]).toMatchObject({ t: 'welcome', members: MAX_MEMBERS });
  for (const p of peers) p.ws.close();
  penolak.ws.close();
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
  states(): string[];
  untilStates(n: number): Promise<string[]>;
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
    states: () => frames.filter((f) => body(f).t === 'state'),
    // Dipisah dari `until` karena satu orang baru masuk = satu frame state ekstra untuk
    // SEMUA socket yang sudah terbuka; menghitung total frame akan membuat indeks tes
    // lain bergantung pada urutan join.
    untilStates: async (n) => {
      let got: string[] = [];
      for (let tries = 0; (got = frames.filter((f) => body(f).t === 'state')).length < n && tries < 200; tries++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      if (got.length < n) throw new Error(`baru ${got.length} frame state masuk, butuh ${n}`);
      return got;
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
  // `members` ada di sini supaya HP yang sudah di ruangan bisa tahu ada orang baru, tanpa
  // harus hello ulang — jadi teks frame ini adalah bagian dari kontrak, bukan detail.
  expect(frames[1]).toBe('{"t":"state","bpm":120,"anchorMs":null,"running":false,"members":1}');
  peer.ws.close();
});

it('anggota kedua dilihat oleh koneksi PERTAMA, tanpa ia sambung ulang', async () => {
  // Inti T6: `members` cuma ada di frame welcome, dan welcome hanya dikirim saat hello.
  // Pemimpin yang tidak hello ulang therefore membeku pada angka waktu ia masuk — layar
  // '1 HP' sementara HP ke-2 sudah berbunyi sephase di ruangan yang sama.
  const a = await openPeer('TMPH');
  a.send({ t: 'hello', sid: 'TMPH', did: 'devPemimpin' });
  const awal = await a.untilStates(1);
  expect(body(awal[0])).toMatchObject({ t: 'state', members: 1 });

  const b = await openPeer('TMPH');
  b.send({ t: 'hello', sid: 'TMPH', did: 'devPengikut' });
  await b.untilStates(1);

  // a TIDAK mengirim hello kedua dan tidak pernah menutup socketnya: satu-satunya cara
  // angka itu bisa sampai ke dia adalah server yang mengulangnya.
  const setelah = await a.untilStates(2);
  expect(body(setelah[1])).toMatchObject({ t: 'state', members: 2 });
  expect(a.frames.filter((f) => body(f).t === 'welcome')).toHaveLength(1);
  a.ws.close();
  b.ws.close();
});

it('hello ulang dari HP yang sama tidak menyiarkan angka ke seluruh ruangan', async () => {
  // Join kembali setelah putus harus tidak boleh mengirim frame ekstra ke HP lain: dua
  // belas HP reload serentak = dua belas broadcast per HP, dan klik sedang berjalan.
  const a = await openPeer('TMPL');
  a.send({ t: 'hello', sid: 'TMPL', did: 'devSatu' });
  await a.untilStates(1);
  const b = await openPeer('TMPL');
  b.send({ t: 'hello', sid: 'TMPL', did: 'devDua' });
  await a.untilStates(2);
  const jumlah = a.states().length + b.states().length;

  b.send({ t: 'hello', sid: 'TMPL', did: 'devDua' });
  await b.untilStates(2);
  expect(body(b.states()[1])).toMatchObject({ members: 2 });
  expect(a.states()).toHaveLength(2);
  expect(a.states().length + b.states().length).toBe(jumlah + 1);
  a.ws.close();
  b.ws.close();
});

it('orang ke-13 ditolak FULL tanpa membuat hitungan HP jadi 13', async () => {
  // MAX_MEMBERS dijaga di hello() atas jumlah socket hidup (§6.2). Kalau angka itu dihitung
  // seperti welcome lama — "total + 1" — ruangan yang penuh melaporkan satu HP hantu ke
  // sebelas HP yang sudah di dalam. Yang ditolak memang masih memegang satu socket, TAPI
  // penolakan tidak menyiarkan apa pun, jadi angka TERAKHIR yang dilihat ruangan tetap 12
  // sampai ada peristiwa yang benar-benar menyiarkan (lihat tes FULL di atas).
  const peers: Peer[] = [];
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const p = await openPeer('TMPJ');
    p.send({ t: 'hello', sid: 'TMPJ', did: `dev${i}` });
    peers.push(p);
  }
  // Tiap orang yang sudah masuk ikut menyiarkan, jadi HP pertama melihat 1..12 berjalan.
  await peers[0]!.untilStates(MAX_MEMBERS);
  const sebelum = peers.map((p) => p.frames.length);

  const penolak = await openPeer('TMPJ');
  penolak.send({ t: 'hello', sid: 'TMPJ', did: 'devTerlalu' });
  await penolak.until(1);
  expect(body(penolak.frames[0])).toMatchObject({ t: 'error', code: 'FULL' });
  // Yang sudah di dalam: tidak ada frame baru sama sekali, dan angka terakhir tetap 12 —
  // bukan 13 (HP hantu) dan bukan 11 (jumlah sebelum orang terakhir).
  await new Promise((r) => setTimeout(r, 40));
  expect(peers.map((p) => p.frames.length)).toEqual(sebelum);
  for (const p of peers) {
    expect(body(p.states().at(-1)!).members).toBe(MAX_MEMBERS);
  }
  for (const p of peers) p.ws.close();
  penolak.ws.close();
});


it('start menyebarkan anchor yang sama persis ke semua socket terbuka', async () => {
  const { sid, lk } = await mintPemimpin('30');
  const a = await openPeer(sid);
  const b = await openPeer(sid);
  a.send({ t: 'hello', sid, did: 'devA', lk });
  b.send({ t: 'hello', sid, did: 'devB' });
  // a sudah berdiri ketika b masuk, jadi ia punya satu frame state ekstra — itu justru
  // yang dituntut T6. Karena itu yang dibandingkan frame TERAKHIR, bukan indeks mentah.
  await a.untilStates(2);
  await b.untilStates(1);

  a.send({ t: 'start' });
  const lastA = (await a.untilStates(3)).at(-1)!;
  const lastB = (await b.untilStates(2)).at(-1)!;
  // Byte-identik: kalau dua HP menerima teks berbeda, ada dua versi kebenaran di ruangan.
  expect(lastA).toBe(lastB);
  const state = body(lastA);
  expect(state).toMatchObject({ t: 'state', bpm: 120, running: true, members: 2 });
  expect(Number(state.anchorMs)).toBeGreaterThan(Date.now());
  a.ws.close();
  b.ws.close();
});

it('tempo saat berjalan mendarat di batas grid lama, bukan di tengah beat', async () => {
  const { sid, lk } = await mintPemimpin('31');
  const peer = await openPeer(sid);
  peer.send({ t: 'hello', sid, did: 'devC', lk });
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
  // Tunggu sampai KEDUA join benar-benar selesai sebelum menghitung jawaban: b membuka
  // socketnya sebelum hello, jadi ia ikut kebagian siaran join a (satu state ekstra), dan
  // frame itu tidak boleh disalahartikan sebagai respons tempo cacat.
  await a.untilStates(2);
  await b.untilStates(2);
  const sebelumB = b.frames.length;
  for (const bpm of cacat) a.send({ t: 'tempo', bpm });
  // 2 siaran join + welcome + 1 state miliknya sendiri = 3 frame dasar, lalu 5 error.
  const framesA = await a.until(3 + cacat.length);
  expect(framesA).toHaveLength(3 + cacat.length);
  expect(framesA.filter((f) => body(f).t === 'error').map((f) => body(f).code)).toEqual(
    cacat.map(() => 'BAD_BPM')
  );
  // b diam-diam saja: tidak ada satu frame pun baru sesudah kedua orang masuk.
  await new Promise((r) => setTimeout(r, 40));
  expect(b.frames.length).toBe(sebelumB);
  a.ws.close();
  b.ws.close();
});

it('tombol start yang ditekan dua kali tidak menulis dua kali', async () => {
  const { sid, lk } = await mintPemimpin('32');
  const peer = await openPeer(sid);
  peer.send({ t: 'hello', sid, did: 'devF', lk });
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
  const { sid, lk } = await mintPemimpin('33');
  const peer = await openPeer(sid);
  peer.send({ t: 'hello', sid, did: 'devG', lk });
  await peer.until(2);
  peer.send({ t: 'tempo', bpm: 90 });
  const stopped = await peer.until(3);
  expect(statesOf(stopped)[1]).toMatchObject({ bpm: 90, running: false, anchorMs: null });
  peer.send({ t: 'start' });
  const started = await peer.until(4);
  expect(statesOf(started)[2]).toMatchObject({ bpm: 90, running: true });
  peer.ws.close();
});

// —— M3a: otoritas pemimpin di server ——
//
// `lk` = kapabilitas PEMIMPIN yang dicetak /create dan tidak pernah lewat tautan join. Yang
// diuji di bawah adalah janji §3: perintah tempo/start/stop hanya dilayani untuk socket yang
// sudah terikat ke leaderDid, dan rebut kendali hanya sah dengan kunci yang sama.

it('pengikut tanpa lk yang mengirim tempo ditolak, dan grid ruangan tidak tersentuh', async () => {
  const { sid, lk } = await mintPemimpin('40');
  const pemimpin = await openPeer(sid);
  pemimpin.send({ t: 'hello', sid, did: 'devPemimpin', lk });
  await pemimpin.untilStates(1);
  const pengikut = await openPeer(sid);
  pengikut.send({ t: 'hello', sid, did: 'devPengikut' });
  await pemimpin.untilStates(2);

  // Teks mentah, bukan hasil parse: yang diklaim di judul tes adalah "sama persis".
  const sebelum = pemimpin.states().at(-1)!;
  pengikut.send({ t: 'tempo', bpm: 60 });
  const jawab = (await pengikut.until(3)).map(body);
  expect(jawab.filter((f) => f.t === 'error')).toEqual([{ t: 'error', code: 'NOT_LEADER' }]);
  await new Promise((r) => setTimeout(r, 40));
  // Yang ditolak tidak boleh meninggalkan satu frame siaran pun, dan `bpm`/`anchorMs`
  // kedua layar harus tetap teks yang sama persis.
  expect(pengikut.states().at(-1)).toBe(sebelum);
  expect(pemimpin.frames.map(body).filter((f) => f.t === 'state')).toHaveLength(2);
  expect(body(sebelum)).toMatchObject({ bpm: 120, anchorMs: null, running: false, members: 2 });
  pemimpin.ws.close();
  pengikut.ws.close();
});

it('HP yang membawa lk boleh mengubah tempo; tanpa lk kursinya kosong', async () => {
  const { sid, lk } = await mintPemimpin('41');
  const peer = await openPeer(sid);
  peer.send({ t: 'hello', sid, did: 'devSatu' });
  await peer.untilStates(1);

  // Ruangan tanpa satu pun lk: §3 menolak "otoritas tanpa kunci", jadi tidak ada yang boleh
  // memerintah — bukan "siapa saja boleh sampai ada yang klaim".
  peer.send({ t: 'tempo', bpm: 96 });
  const kosong = (await peer.until(3)).map(body);
  expect(kosong.filter((f) => f.t === 'error')).toEqual([{ t: 'error', code: 'NOT_LEADER' }]);
  expect(statesOf(peer.frames).at(-1)).toMatchObject({ bpm: 120 });

  // Kunci yang sama, satu hello lagi di socket yang sama → podium terikat ke did ini →
  // perintah yang sama lahir.
  peer.send({ t: 'hello', sid, did: 'devSatu', lk });
  await peer.untilStates(2);
  peer.send({ t: 'tempo', bpm: 96 });
  const lahir = await peer.untilStates(3);
  expect(body(lahir.at(-1)!)).toMatchObject({ t: 'state', bpm: 96, running: false, members: 1 });
  peer.ws.close();
});

it('pemimpin yang reconnect dengan did yang sama tetap pemimpin tanpa /create baru', async () => {
  const { sid, lk } = await mintPemimpin('42');
  const a = await openPeer(sid);
  a.send({ t: 'hello', sid, did: 'devPemimpin', lk });
  await a.untilStates(1);
  a.send({ t: 'tempo', bpm: 100 });
  expect(body((await a.untilStates(2)).at(-1)!)).toMatchObject({ bpm: 100 });
  a.ws.close();

  // Jalur "Lanjut ke sesi" (Start.tsx + rememberTarget): socket baru, did lama, lk dari
  // localStorage. Kendali harus kembali tanpa /create baru dan tanpa tombol rebut.
  const b = await openPeer(sid);
  b.send({ t: 'hello', sid, did: 'devPemimpin', lk });
  await b.untilStates(1);
  b.send({ t: 'tempo', bpm: 140 });
  expect(body((await b.untilStates(2)).at(-1)!)).toMatchObject({ t: 'state', bpm: 140, running: false });
  b.ws.close();
});

it('dua HP yang sama-sama membawa lk: yang pertama mengikat, yang kedua tidak memerintah', async () => {
  const { sid, lk } = await mintPemimpin('43');
  const a = await openPeer(sid);
  a.send({ t: 'hello', sid, did: 'devSatu', lk });
  await a.untilStates(1);
  const b = await openPeer(sid);
  // Kunci yang sama SAMA SEKALI tidak berarti podium dua-duanya: lk hanya mengikat kalau
  // belum ada pemimpin, setelah itu jalurnya adalah rebut eksplisit (`claim`).
  b.send({ t: 'hello', sid, did: 'devDua', lk });
  await a.untilStates(2);

  b.send({ t: 'tempo', bpm: 60 });
  const jawab = (await b.until(3)).map(body);
  expect(jawab.filter((f) => f.t === 'error')).toEqual([{ t: 'error', code: 'NOT_LEADER' }]);
  expect(statesOf(b.frames).at(-1)).toMatchObject({ bpm: 120 });

  a.send({ t: 'tempo', bpm: 132 });
  expect(body((await a.untilStates(3)).at(-1)!)).toMatchObject({ t: 'state', bpm: 132 });
  a.ws.close();
  b.ws.close();
});

it('claim dengan lk memindahkan podium, claim tanpa lk tidak menggeser apa pun', async () => {
  const { sid, lk } = await mintPemimpin('44');
  const pemimpin = await openPeer(sid);
  pemimpin.send({ t: 'hello', sid, did: 'devLama', lk });
  await pemimpin.untilStates(1);
  const anggota = await openPeer(sid);
  anggota.send({ t: 'hello', sid, did: 'devBaru' });
  await pemimpin.untilStates(2);
  const penantang = await openPeer(sid);
  penantang.send({ t: 'hello', sid, did: 'devTiga' });
  await pemimpin.untilStates(3);
  const diam = [pemimpin, anggota].map((p) => p.frames.length);

  // Klaim tanpa kunci: jawaban hanya ke pengirim, ruangan tidak boleh melihat satu frame pun.
  penantang.send({ t: 'claim' });
  const tolak = (await penantang.until(3)).map(body);
  expect(tolak.filter((f) => f.t === 'error')).toEqual([{ t: 'error', code: 'NOT_LEADER' }]);
  await new Promise((r) => setTimeout(r, 40));
  expect([pemimpin, anggota].map((p) => p.frames.length)).toEqual(diam);

  // leaderDid tidak goyah: pemimpin lama masih yang boleh memerintah.
  pemimpin.send({ t: 'tempo', bpm: 132 });
  const tetap = await pemimpin.untilStates(4);
  expect(body(tetap.at(-1)!)).toMatchObject({ t: 'state', bpm: 132, running: false, members: 3 });

  // Rebut yang sah: lk diverifikasi ULANG dari frame ini — tidak percaya hasil hello —
  // leaderDid pindah, dan state disiarkan ke seluruh ruangan (anggota ikut menerimanya).
  // Yang ditunggu di TIAP layar adalah salinan miliknya sendiri: siaran claim dan siaran
  // tempo(132) berangkat ke dua socket yang sama, jadi menunggu angka anggota saja bisa
  // selesai sebelum salinan pemimpin mendarat (terukur: jalan pertama berhenti di 5 frame, bukan 6).
  anggota.send({ t: 'claim', lk });
  const pindah = await pemimpin.untilStates(5);
  expect(body(pindah.at(-1)!)).toMatchObject({ t: 'state', bpm: 132, members: 3 });
  expect((await anggota.untilStates(4)).at(-1)).toBe(pindah.at(-1));
  expect(pemimpin.frames.length).toBe(diam[0]! + 2);

  anggota.send({ t: 'tempo', bpm: 76 });
  expect(body((await anggota.untilStates(5)).at(-1)!)).toMatchObject({ t: 'state', bpm: 76 });
  // Podium sudah pindah: perintah yang sama dari HP yang tadinya pemimpin sekarang ditolak.
  pemimpin.send({ t: 'tempo', bpm: 99 });
  const turun = (await pemimpin.until(8)).map(body);
  expect(turun.filter((f) => f.t === 'error')).toEqual([{ t: 'error', code: 'NOT_LEADER' }]);
  pemimpin.ws.close();
  anggota.ws.close();
  penantang.ws.close();
});

it('socket yang ditutup menurunkan jumlah kursi di layar HP yang masih di dalam', async () => {
  const a = await openPeer('TMPM');
  a.send({ t: 'hello', sid: 'TMPM', did: 'devSatu' });
  await a.untilStates(1);
  const b = await openPeer('TMPM');
  b.send({ t: 'hello', sid: 'TMPM', did: 'devDua' });
  expect(body((await a.untilStates(2)).at(-1)!)).toMatchObject({ t: 'state', members: 2 });

  // Bayaran §4 butir 2c: tanpa siaran di webSocketClose angka ini baru TURUN ketika ada
  // orang mengubah tempo — dan hari itu pemimpin sedang tidak mengubah apa-apa.
  b.ws.close();
  expect(body((await a.untilStates(3)).at(-1)!)).toMatchObject({
    t: 'state',
    bpm: 120,
    running: false,
    members: 1,
  });
  a.ws.close();
});

