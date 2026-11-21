import { env, evictDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { MAX_FRAME_BYTES, parseFrame } from '../shared/limits';
import { MAX_JUDUL, MAX_SETLIST, type Song } from '../shared/setlist';
import worker from './index';

// M3b — setlist. Yang dijaga di sini bukan \"bisa menambah lagu\", tapi tiga sifat yang membuat
// daftar itu aman dipakai di ruangan berisi dua belas HP:
//   1. otoritasnya sama dengan `tempo` — satu kemampuan, satu kunci `lk` (T1/T2),
//   2. batasnya diukur, bukan dijanjikan: 20 lagu, judul 40 karakter, bpm 30..300 (T4),
//   3. daftarnya hidup di SQLite, jadi DO yang tidur tidak melupakan lagu yang sudah disusun (T3).
// T7 mengukur frame `state` dengan 20 lagu: ukuran dan kedalamannya, bukan dugaan dari kertas.

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
  const raw = (res as unknown as { webSocket?: WebSocket }).webSocket;
  if (!raw) throw new Error('DO mengembalikan Response tanpa .webSocket: Upgrade tidak diterima');
  const ws = raw as CfSocket;
  ws.accept();
  const frames: string[] = [];
  ws.addEventListener('message', (ev) => frames.push(String(ev.data)));
  const sejak = (n: number) => frames.slice(n).map(json);
  // Menunggu frame yang cocok, BUKAN jumlah frame: satu perintah pemimpin menghasilkan siaran
  // ke semua socket, jadi jumlahnya bergantung pada berapa HP yang sedang di dalam.
  const tunggu = async (pred: (f: Record<string, unknown>) => boolean, dari = 0, ms = 3000) => {
    for (let i = 0; i < ms / 10; i++) {
      const hit = frames.slice(dari).map(json).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  const tenang = async (ms = 200) => new Promise((r) => setTimeout(r, ms));
  const terakhir = () => frames.map(json).filter((f) => f.t === 'state').at(-1);
  return { stub, ws, frames, kirim: (f: unknown) => ws.send(JSON.stringify(f)), sejak, tunggu, tenang, terakhir };
}

const setlistOf = (f: Record<string, unknown> | undefined) => (f?.setlist ?? []) as Song[];

it('T1/T2 — perintah setlist dari socket tanpa lk (termasuk yang ber-did pemimpin) ditolak tanpa siaran', async () => {
  const { sid, lk } = await lahir('301');
  const pemimpin = await buka(sid);
  pemimpin.kirim({ t: 'hello', sid, did: 'lead0301', lk });
  expect(await pemimpin.tunggu((f) => f.t === 'welcome'), 'pemimpin harus masuk dulu').not.toBeNull();

  const pengikut = await buka(sid);
  pengikut.kirim({ t: 'hello', sid, did: 'ikut0301' });
  await pemimpin.tunggu((f) => f.t === 'state' && f.members === 2);

  // Peniru mengarang `did` pemimpin dari frame — persis jalur yang ditutup S8-b. Tanpa `lk`,
  // string itu tidak membawa otoritas apa pun.
  const peniru = await buka(sid);
  peniru.kirim({ t: 'hello', sid, did: 'lead0301' });
  await pemimpin.tunggu((f) => f.t === 'state' && f.members === 3);

  const dasarPemimpin = pemimpin.frames.length;
  const dasarPengikut = pengikut.frames.length;
  const dasarPeniru = peniru.frames.length;
  const perintah = { t: 'lagu', op: 'tambah', judul: 'Intro', bpm: 120 };
  pengikut.kirim(perintah);
  peniru.kirim(perintah);
  peniru.kirim({ t: 'lagu', op: 'pilih', id: 1 });
  await peniru.tenang();

  expect(pengikut.sejak(dasarPengikut).filter((f) => f.t === 'error').map((f) => f.code)).toEqual(['NOT_LEADER']);
  expect(peniru.sejak(dasarPeniru).filter((f) => f.t === 'error').map((f) => f.code)).toEqual([
    'NOT_LEADER',
    'NOT_LEADER',
  ]);
  // Nol frame ke pemimpin: bukan cuma \"ditolak\", tapi keadaan ruangan tidak tersentuh.
  expect(pemimpin.sejak(dasarPemimpin)).toEqual([]);
  expect(setlistOf(pemimpin.terakhir())).toEqual([]);

  // Kontrol positif: perintah yang sama dari pemegang `lk` benar-benar bekerja.
  pemimpin.kirim(perintah);
  const sesudah = await pemimpin.tunggu((f) => f.t === 'state' && setlistOf(f).length === 1, dasarPemimpin);
  expect(sesudah, 'perintah sah harus diterima sesudah dua penolakan').not.toBeNull();
  for (const p of [pemimpin, pengikut, peniru]) p.ws.close();
});

it('lagu yang ditambah, digeser, dan dihapus disiarkan byte-identik ke semua HP', async () => {
  const { sid, lk } = await lahir('302');
  const pemimpin = await buka(sid);
  pemimpin.kirim({ t: 'hello', sid, did: 'lead0302', lk });
  await pemimpin.tunggu((f) => f.t === 'welcome');
  const pengikut = await buka(sid);
  pengikut.kirim({ t: 'hello', sid, did: 'ikut0302' });
  await pemimpin.tunggu((f) => f.t === 'state' && f.members === 2);

  const tambah = async (judul: string, bpm: number) => {
    const dari = pemimpin.frames.length;
    pemimpin.kirim({ t: 'lagu', op: 'tambah', judul, bpm });
    const f = await pemimpin.tunggu((x) => x.t === 'state' && setlistOf(x).length > 0, dari);
    expect(f, `tambah ${judul} harus disiarkan`).not.toBeNull();
    return f!;
  };

  await tambah('Intro', 100);
  const dua = await tambah('Verse', 120);
  const tiga = await tambah('Chorus', 140);
  expect(setlistOf(tiga).map((s) => s.judul)).toEqual(['Intro', 'Verse', 'Chorus']);
  expect(setlistOf(tiga).map((s) => s.bpm)).toEqual([100, 120, 140]);

  // Dua HP membaca frame TERAKHIR yang sama persis: kalau teksnya beda, ada dua versi setlist.
  expect(pengikut.terakhir()).toEqual(dua === tiga ? tiga : tiga);
  const verse = setlistOf(tiga)[1]!;

  // Naik: Verse pindah ke atas Intro, dan id-nya TIDAK berubah (urutan bukan kunci baris).
  const dasarGeser = pemimpin.frames.length;
  pemimpin.kirim({ t: 'lagu', op: 'naik', id: verse.id });
  const geser = await pemimpin.tunggu((f) => f.t === 'state' && setlistOf(f)[0]?.judul === 'Verse', dasarGeser);
  expect(geser, 'naik harus mengubah urutan yang disiarkan').not.toBeNull();
  expect(setlistOf(geser!).map((s) => s.id)).toEqual([verse.id, setlistOf(tiga)[0]!.id, setlistOf(tiga)[2]!.id]);
  expect(pengikut.terakhir()).toEqual(geser);

  // Turun di ujung bawah tidak mengubah apa pun, dan tidak membangunkan siapa pun.
  const dasarUjung = pemimpin.frames.length;
  pemimpin.kirim({ t: 'lagu', op: 'naik', id: verse.id });
  await pemimpin.tenang();
  expect(pemimpin.frames.length).toBe(dasarUjung);

  // Hapus: yang dihapus lenyap dari kedua layar.
  const dasarHapus = pemimpin.frames.length;
  pemimpin.kirim({ t: 'lagu', op: 'hapus', id: verse.id });
  const hapus = await pemimpin.tunggu((f) => f.t === 'state' && setlistOf(f).length === 2, dasarHapus);
  expect(hapus, 'hapus harus disiarkan').not.toBeNull();
  expect(setlistOf(hapus!).map((s) => s.judul)).toEqual(['Intro', 'Chorus']);
  expect(pengikut.terakhir()).toEqual(hapus);
  pemimpin.ws.close();
  pengikut.ws.close();
});

it('T4 — lagu ke-21, judul di luar batas, dan bpm di luar 30..300 ditolak tanpa mengubah daftar', async () => {
  const { sid, lk } = await lahir('303');
  const p = await buka(sid);
  p.kirim({ t: 'hello', sid, did: 'lead0303', lk });
  await p.tunggu((f) => f.t === 'welcome');

  const cacat = [
    { judul: '', bpm: 120 },
    { judul: '   ', bpm: 120 },
    { judul: 'x'.repeat(MAX_JUDUL + 1), bpm: 120 },
    { judul: 'Intro', bpm: 29 },
    { judul: 'Intro', bpm: 301 },
    { judul: 'Intro', bpm: 120.5 },
    { judul: 'Intro', bpm: '120' },
    { judul: 42, bpm: 120 },
  ];
  for (const frame of cacat) {
    const dari = p.frames.length;
    p.kirim({ t: 'lagu', op: 'tambah', ...frame });
    const jawab = await p.tunggu((f) => f.t === 'error', dari);
    expect(jawab, `tambah cacat ${JSON.stringify(frame)} harus dijawab`).toMatchObject({ code: 'BAD_SONG' });
  }
  // 20 lagu dengan judul sepanjang batas: jumlah yang diizinkan, dan batasnya dibaca dari
  // konstanta yang sama dengan yang dipakai layar.
  for (let i = 0; i < MAX_SETLIST; i++) {
    const dari = p.frames.length;
    p.kirim({ t: 'lagu', op: 'tambah', judul: `Lagu ${i} ${'x'.repeat(MAX_JUDUL - 8)}`, bpm: 120 });
    expect(await p.tunggu((f) => f.t === 'state' && setlistOf(f).length === i + 1, dari)).not.toBeNull();
  }
  const dasar = p.frames.length;
  p.kirim({ t: 'lagu', op: 'tambah', judul: 'Lagu ke-21', bpm: 120 });
  expect(await p.tunggu((f) => f.t === 'error', dasar)).toMatchObject({ code: 'FULL_SETLIST' });
  await p.tenang();
  expect(setlistOf(p.terakhir())).toHaveLength(MAX_SETLIST);
  // frame(state) dengan 20 lagu: ukuran dan kedalaman DIUKUR, bukan dihitung di atas kertas.
  const teks = p.frames.filter((f) => json(f).t === 'state').at(-1)!;
  expect(teks.length).toBeLessThan(MAX_FRAME_BYTES);
  expect(() => parseFrame(teks)).not.toThrow();
  p.ws.close();
});

it('T5 — memilih lagu menggerakkan tempo lewat jahitan grid yang sama dengan retune', async () => {
  const { sid, lk } = await lahir('304');
  const p = await buka(sid);
  p.kirim({ t: 'hello', sid, did: 'lead0304', lk });
  await p.tunggu((f) => f.t === 'welcome');
  for (const [judul, bpm] of [
    ['Intro', 120],
    ['Verse', 90],
  ]) {
    const dari = p.frames.length;
    p.kirim({ t: 'lagu', op: 'tambah', judul, bpm });
    await p.tunggu((f) => f.t === 'state', dari);
  }
  const lagu = setlistOf(p.terakhir());
  p.kirim({ t: 'start' });
  const jalan = await p.tunggu((f) => f.t === 'state' && f.running === true);
  const anchorLama = Number(jalan!.anchorMs);

  const dasar = p.frames.length;
  p.kirim({ t: 'lagu', op: 'pilih', id: lagu[1]!.id });
  const pilih = await p.tunggu((f) => f.t === 'state' && f.bpm === 90, dasar);
  expect(pilih, 'pilih lagu harus memindahkan tempo ke bpm lagu itu').not.toBeNull();
  expect(pilih).toMatchObject({ running: true, laguAktif: lagu[1]!.id });
  // 120 BPM = 500 ms persis, jadi jahitannya harus jatuh di kelipatan periode lama.
  const delta = Number(pilih!.anchorMs) - anchorLama;
  expect(delta).toBeGreaterThanOrEqual(0);
  expect(delta % 500).toBe(0);

  // Memilih lagu yang bpm-nya sama tetap disiarkan (yang berubah lagu aktifnya), tapi grid
  // tidak digeser: tidak ada klik yang dipindahkan tanpa alasan.
  const dasarSama = p.frames.length;
  p.kirim({ t: 'lagu', op: 'pilih', id: lagu[1]!.id });
  const sama = await p.tunggu((f) => f.t === 'state', dasarSama);
  expect(sama).toMatchObject({ bpm: 90, anchorMs: pilih!.anchorMs });

  p.kirim({ t: 'lagu', op: 'pilih', id: 99999 });
  expect(await p.tunggu((f) => f.t === 'error', dasarSama)).toMatchObject({ code: 'BAD_SONG' });
  p.ws.close();
});

it('T3 — setlist dan lagu aktif dibaca ulang dari SQLite sesudah DO di-evict', async () => {
  const { sid, lk } = await lahir('305');
  const p = await buka(sid);
  p.kirim({ t: 'hello', sid, did: 'lead0305', lk });
  await p.tunggu((f) => f.t === 'welcome');
  for (const [judul, bpm] of [
    ['Intro', 112],
    ['Verse', 96],
  ]) {
    const dari = p.frames.length;
    p.kirim({ t: 'lagu', op: 'tambah', judul, bpm });
    await p.tunggu((f) => f.t === 'state', dari);
  }
  const lagu = setlistOf(p.terakhir());
  const dasarPilih = p.frames.length;
  p.kirim({ t: 'lagu', op: 'pilih', id: lagu[1]!.id });
  expect(await p.tunggu((f) => f.t === 'state' && f.laguAktif === lagu[1]!.id, dasarPilih)).not.toBeNull();

  await evictDurableObject(p.stub);
  const dasar = p.frames.length;
  // hello ulang sesudah evict: yang menjawab adalah instance baru yang hanya punya SQLite.
  p.kirim({ t: 'hello', sid, did: 'lead0305', lk });
  const bangun = await p.tunggu((f) => f.t === 'state', dasar);
  expect(bangun, 'hello sesudah evict harus menjawab state').not.toBeNull();
  expect(setlistOf(bangun!).map((s) => s.judul)).toEqual(['Intro', 'Verse']);
  expect(bangun).toMatchObject({ laguAktif: lagu[1]!.id, bpm: 96 });
  p.ws.close();
});
