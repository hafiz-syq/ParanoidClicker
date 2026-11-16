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
  // Versi jendela dari `cari`. Pelajaran TEMUAN 5: `cari` memindai dari indeks 0, jadi sebuah
  // penolakan dari langkah SEBELUMNYA bisa membuat assertion "harus ada NOT_LEADER" lulus tanpa
  // pernah membaca jawaban langkah ini. Di E satu-satunya hal yang boleh ditunggu adalah frame
  // yang lahir sesudah indeks diambil.
  const nungguDalam = async (dari: number, pred: (f: Record<string, unknown>) => boolean, ms = 3000) => {
    for (let i = 0; i < ms / 10; i++) {
      const hit = frames.slice(dari).map(json).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  return { stub, ws, frames, kirim: (f: unknown) => ws.send(JSON.stringify(f)), cari, tenang, sejak, nungguDalam };
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
  // Bangkitnya DO lewat socket LAIN dulu, bukan lewat pemimpin: ping pengikut harus dijawab
  // `pong`, baru kemudian pemimpin hello ulang. Urutan ini yang meniru ruangan sungguhan — yang
  // membangunkan DO biasanya trafik orang lain, bukan orang yang kehilangan podium — dan langkah
  // ini yang hilang dari versi saya sebelum lampiran checker ronde ini masuk (tes ke-4 mereka,
  // `kursi (members) sesudah evict: apakah getWebSockets bertahan`, `:109`).
  q.kirim({ t: 'ping', nonce: 1, t1: Date.now() });
  const pong = await q.cari((f) => f.t === 'pong' && f.nonce === 1, 1500);
  expect(pong, 'pengikut harus tetap dilayani sesudah DO di-evict').not.toBeNull();
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
  const dasar = pengikut.frames.length;
  pengikut.kirim({ t: 'claim' });
  await pengikut.tenang();
  // Jendela TERPISAH, bukan `cari`: `cari` memindai `frames` dari indeks 0, sementara baris
  // `tempo` di atas sudah memproduksi satu NOT_LEADER — jadi assertion claim yang lama dijamin
  // lulus tanpa pernah membaca jawaban claim. Angka itu terukur (checker ronde ini: 1 NOT_LEADER
  // sudah ada sebelum claim dikirim), dan bug-nya ada di pagarnya, bukan di perilakunya.
  const jendela = pengikut.sejak(dasar);
  expect(
    jendela.filter((f) => f.t === 'error' && f.code === 'NOT_LEADER').length,
    `claim tanpa lk harus dijawab TEPAT SATU NOT_LEADER, dapat ${kerangka(jendela)}`
  ).toBe(1);
  expect(
    jendela.filter((f) => f.t === 'state').length,
    `claim tanpa lk tidak boleh menyiarkan apa pun, dapat ${kerangka(jendela)}`
  ).toBe(0);
  expect(pengikut.frames.map(json).filter((f) => f.t === 'state' && f.bpm === 180), 'bpm 180 tidak boleh pernah disiarkan').toEqual([]);

  pemimpin.ws.close();
  pengikut.ws.close();
});

// E = TEMUAN 4, dijawab pemilik dengan model (b) — "Ikat ke lk terverifikasi", 2026-11-16T23:06:05.165Z
// (`call_8f1f79b4baf847cfb47cecaf`, kanal sesi checker 2d6f4ca7-3aba-44e4-ab8d-470daf00b560; alamat
// lengkapnya di docs/plans/2026-11-15-m3-otoritas-pemimpin.plan.md §8.2 baris `S8`).
// E tidak menguji hibernasi sebagai subjek: ia menuntut SIFAT yang membuat perbaikan TEMUAN 1 aman —
// identitas di attachment ikut membawa bukti kripto, bukan cuma string yang bisa dikarang klien.
// Fase 2 (sesudah evict) ada di sini justru karena jalur itu sekarang berbagi satu tempat penyimpanan
// dengan otoritas; memisahkannya jadi tes sendiri cuma mengulang A.
it('E — socket ber-did pemimpin tanpa lk tidak boleh memerintah, sebelum maupun sesudah evict', async () => {
  const { sid, lk } = await lahir('205');
  const pemimpin = await buka(sid);
  pemimpin.kirim({ t: 'hello', sid, did: 'lead0005', lk });
  await pemimpin.cari((f) => f.t === 'welcome');

  const peniru = await buka(sid);
  // `did` pemimpin murni dikarang dari frame: yang dijaga server cuma panjang 1..32
  // (`SessionDO.ts:110`), tidak ada charset dan tidak ada bukti apa pun. Sebelum (b), string
  // yang cocok itulah satu-satunya yang diperiksa `assertLeader`.
  peniru.kirim({ t: 'hello', sid, did: 'lead0005' });
  await pemimpin.cari((f) => f.t === 'state' && f.members === 2);

  // Kontrol, bukan serangan: kalau 140 saja tidak diterima, yang merah nanti adalah tes yang
  // kebalikannya (semua orang ditolak) dan itu tetap lulus sebagai "peniru ditolak".
  pemimpin.kirim({ t: 'tempo', bpm: 140 });
  expect(await pemimpin.cari((f) => f.t === 'state' && f.bpm === 140), 'tempo 140 dari pemimpin sah harus diterima SEBELUM serangan').not.toBeNull();

  const serang = async (bpm: number, label: string) => {
    const dasarPemimpin = pemimpin.frames.length;
    const dasarPeniru = peniru.frames.length;
    peniru.kirim({ t: 'tempo', bpm });
    const jawab = await peniru.nungguDalam(dasarPeniru, (f) => f.t === 'error' || f.t === 'state');
    const jendelaPeniru = peniru.sejak(dasarPeniru);
    expect(jawab, `${label}: peniru harus mendapat jawaban di jendelanya sendiri, dapat ${kerangka(jendelaPeniru)}`).not.toBeNull();
    expect(
      jawab && jawab.t,
      `${label}: peniru ber-did sama tanpa lk harus DITOLAK, bukan dilayani, dapat ${kerangka(jendelaPeniru)}`
    ).toBe('error');
    expect(
      jendelaPeniru.filter((f) => f.t === 'error' && f.code === 'NOT_LEADER').length,
      `${label}: harus dijawab TEPAT SATU NOT_LEADER, dapat ${kerangka(jendelaPeniru)}`
    ).toBe(1);
    expect(
      jendelaPeniru.filter((f) => f.t === 'state').length,
      `${label}: peniru tidak boleh melihat state, dapat ${kerangka(jendelaPeniru)}`
    ).toBe(0);
    // Pemimpin sah dibaca SESUDAH jawaban peniru terlihat: keputusan siaran diambil di DO yang
    // sama dan di putaran yang sama, jadi kalau penolakannya sudah ada, tidak ada lagi yang bisa
    // mendarat di layar pemimpin dari frame ini.
    await pemimpin.tenang(400);
    const jendelaPemimpin = pemimpin.sejak(dasarPemimpin);
    expect(
      jendelaPemimpin.filter((f) => f.t === 'state').length,
      `${label}: bpm ${bpm} tidak boleh disiarkan ke SIAPA PUN, termasuk pemimpin sah, dapat ${kerangka(jendelaPemimpin)}`
    ).toBe(0);
  };

  await serang(177, 'fase 1 (sebelum evict)');

  await evictDurableObject(pemimpin.stub);
  await serang(188, 'fase 2 (sesudah evict)');

  // Angka serangan tidak pernah muncul di SATU PUN layar, di seluruh riwayat kedua socket —
  // termasuk kalau penyerang mengulang berkali-kali.
  const siaran = [...pemimpin.frames, ...peniru.frames]
    .map(json)
    .filter((f) => f.t === 'state' && (f.bpm === 177 || f.bpm === 188));
  expect(siaran, `bpm serangan tidak boleh pernah muncul di kedua socket, dapat ${kerangka(siaran)}`).toEqual([]);

  // Sifat yang harus bertahan: penolakan peniru tidak boleh memutus jalan pemimpin sah.
  const dasarKembali = pemimpin.frames.length;
  pemimpin.kirim({ t: 'tempo', bpm: 199 });
  expect(
    await pemimpin.nungguDalam(dasarKembali, (f) => f.t === 'state' && f.bpm === 199),
    'pemimpin sah harus tetap boleh memerintah sesudah evict dan sesudah dua penolakan'
  ).not.toBeNull();

  pemimpin.ws.close();
  peniru.ws.close();
});
