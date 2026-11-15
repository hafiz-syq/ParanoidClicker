import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSession, parseTarget, type SessionState } from './live';

const TOK = 'a'.repeat(64);
const T0 = 1_700_000_000_000;

class FakeWS {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWS[] = [];

  readyState = FakeWS.CONNECTING;
  sent: string[] = [];
  private handlers = new Map<string, ((ev: unknown) => void)[]>();

  constructor(readonly url: string) {
    FakeWS.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }

  emit(type: string, ev: unknown = {}): void {
    for (const fn of this.handlers.get(type) ?? []) fn(ev);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  open(): void {
    this.readyState = FakeWS.OPEN;
    this.emit('open');
  }

  /** Seperti browser: close() oleh pengguna tetap membangkitkan event close. */
  close(): void {
    this.readyState = FakeWS.CLOSED;
    this.emit('close', { code: 1000 });
  }

  /** Frame masuk lewat gerbang yang sama dengan yang dipakai produksi. */
  frame(data: object | string): void {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  get lastPing(): { nonce: number; t1: number } {
    return JSON.parse(this.sent[this.sent.length - 1] ?? '{}') as { nonce: number; t1: number };
  }
}

function install(): void {
  FakeWS.instances = [];
  const store = new Map<string, string>();
  const session = new Map<string, string>();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  Object.assign(globalThis, {
    WebSocket: FakeWS,
    location: { protocol: 'https:', host: 'example.com' },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
    },
  });
}

interface Harness {
  live: LiveSession;
  states: SessionState[];
  members: number[];
  status: string[];
  theta: number[];
  ws(): FakeWS;
}

function harness(sid = 'ABCD'): Harness {
  const states: SessionState[] = [];
  const members: number[] = [];
  const status: string[] = [];
  const theta: number[] = [];
  const live = new LiveSession(
    { sid, tok: TOK },
    {
      onState: (s) => states.push(s),
      onMembers: (n) => void members.push(n),
      onStatus: (l) => status.push(l),
      onTheta: (t) => theta.push(t),
    }
  );
  return { live, states, members, status, theta, ws: () => FakeWS.instances[FakeWS.instances.length - 1]! };
}

/**
 * Pong yang masuk akal secara fisik. Server di depan sejauh `skew`, dan jawaban datang
 * 40 ms setelah ping — jam DIFAKE supaya selisihnya persis, karena toSample membuang
 * sampel ber-RTT nol (yang di localhost justru sering terjadi).
 */
function answerPing(ws: FakeWS, skew = 600): void {
  const { nonce, t1 } = ws.lastPing;
  vi.advanceTimersByTime(40);
  ws.frame({ t: 'pong', nonce, t1, t2: t1 + skew + 20, t3: t1 + skew + 23, t4: Date.now() });
}

beforeEach(install);
afterEach(() => vi.useRealTimers());

describe('parseTarget', () => {
  it('menerima sid + tok yang sah dan menolak sisa bentuknya', () => {
    expect(parseTarget(`?sid=ABCD&tok=${TOK}`)).toEqual({ sid: 'ABCD', tok: TOK });
    expect(parseTarget('')).toBeNull();
    expect(parseTarget(`?sid=ABC1&tok=${TOK}`)).toBeNull();
    expect(parseTarget(`?sid=ABCD&tok=${'a'.repeat(63)}`)).toBeNull();
    expect(parseTarget(`?sid=ABCD&tok=${'A'.repeat(64)}`)).toBeNull();
    expect(parseTarget(`?sid=ABCD&tok=${'0'.repeat(63)}g`)).toBeNull();
  });
});

describe('LiveSession', () => {
  it('hello memakai did yang sama untuk reload, dan menyimpannya', () => {
    const a = harness();
    a.live.connect();
    a.ws().open();
    const did1 = JSON.parse(a.ws().sent[0]!).did as string;
    a.live.close();

    const b = harness();
    b.live.connect();
    b.ws().open();
    // Tanpa ini, setiap reload HP menambah satu member hantu sampai sesi penuh (12 slot).
    expect(JSON.parse(b.ws().sent[0]!).did).toBe(did1);
    expect(did1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('welcome mengisi member dan state mengisi grid', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    ws.frame({ t: 'welcome', sid: 'ABCD', members: 3, rowsWritten: 2, serverNow: T0 + 657 });
    expect(h.members).toEqual([3]);
    ws.frame({ t: 'state', bpm: 90, anchorMs: T0 + 6_000, running: true });
    ws.frame({ t: 'state', bpm: 90, anchorMs: null, running: false });
    expect(h.states).toEqual([
      { bpm: 90, anchorMs: T0 + 6_000, running: true },
      { bpm: 90, anchorMs: null, running: false },
    ]);
  });

  it('state yang membawa members menyegarkan hitungan HP', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    ws.frame({ t: 'welcome', sid: 'ABCD', members: 1, serverNow: T0 + 657 });
    // Pemimpin tidak pernah hello ulang seumur lagunya: kalau `members` hanya dibaca di
    // jalur welcome, layarnya membeku pada angka waktu ia masuk.
    ws.frame({ t: 'state', bpm: 120, anchorMs: null, running: false, members: 2 });
    expect(h.members).toEqual([1, 2]);
    // Frame tanpa members (server lama) tidak boleh menghapus angka yang sudah benar.
    ws.frame({ t: 'state', bpm: 90, anchorMs: null, running: true });
    expect(h.members).toEqual([1, 2]);
    expect(h.states).toHaveLength(2);
  });

  it('bpm jaringan yang tidak sah tidak pernah dibiarkan masuk ke grid', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    // 120.5 menggeser grid per HP (pembulatan peramban berbeda), 3000 membuat periode
    // mendekati nol, dan keduanya datang dari socket — bukan dari keypad pemimpin.
    for (const bpm of [120.5, 3000, 0, -120, '120', Number.NaN]) {
      ws.frame({ t: 'state', bpm, anchorMs: T0 + 5_000, running: true });
    }
    expect(h.states).toEqual([]);
    expect(h.status.filter((s) => /state cacat/.test(s))).toHaveLength(6);
  });

  it('anchor dari jam yang salah nopol ditolak, bukan dipakai untuk menyetel ribuan beat', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    // Jam server 2001 = klik dijadwalkan 25 tahun di depan; 24 jam di depan = lebih jauh
    // dari mana pun jam yang bisa jujur meleset, dan 'sekarang' menjadi NaN.
    ws.frame({ t: 'state', bpm: 120, anchorMs: 978_307_200_000, running: true });
    ws.frame({ t: 'state', bpm: 120, anchorMs: T0 + 24 * 3_600_000, running: true });
    ws.frame({ t: 'state', bpm: 120, anchorMs: 'sekarang', running: true });
    expect(h.states).toEqual([]);
    ws.frame({ t: 'state', bpm: 120, anchorMs: T0 + 5_000, running: true });
    expect(h.states).toEqual([{ bpm: 120, anchorMs: T0 + 5_000, running: true }]);
  });

  it('welcome menanam θ sebelum ada pong satu pun', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    expect(h.live.thetaMs()).toBe(0);
    ws.frame({ t: 'welcome', sid: 'ABCD', members: 1, serverNow: T0 + 657 });
    // θ HP pertama di lapangan 657 ms; tanpa seed ini klik mulai telat satu beat penuh.
    expect(h.live.thetaMs()).toBe(657);
    expect(h.theta).toEqual([657]);
    vi.advanceTimersByTime(1_000);
    answerPing(ws, 600);
    expect(h.live.thetaMs()).toBeCloseTo(601.5, 1);
  });

  it('pingNow mengirim ping detik itu juga, bukan satu detik lagi', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    const n = ws.sent.length;
    h.live.pingNow();
    expect(ws.sent.length).toBe(n + 1);
    expect(JSON.parse(ws.sent[ws.sent.length - 1]!).t).toBe('ping');
  });

  it('state cacat tidak menghapus grid, dan frame kebesaran ditolak', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    ws.frame({ t: 'state', bpm: 'sembilan puluh', anchorMs: 1, running: true });
    expect(h.states).toEqual([]);
    expect(h.status.join(' ')).toMatch(/state cacat/);
    ws.frame(JSON.stringify({ t: 'state', bpm: 120, anchorMs: 1, running: true, pad: 'x'.repeat(9_000) }));
    expect(h.status.join(' ')).toMatch(/frame ditolak: TOO_BIG/);
    ws.frame({ t: 'state', bpm: 100, anchorMs: null, running: false });
    expect(h.states).toEqual([{ bpm: 100, anchorMs: null, running: false }]);
  });

  it('θ dihitung dari pong dan hanya satu sampel per ping', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    vi.advanceTimersByTime(1_000);
    answerPing(ws, 600);
    // θ = server − jam dinding = 600 + 1,5 (setengah RTT 37 ms dikurangi selisih t3−t2).
    expect(h.live.thetaMs()).toBeCloseTo(601.5, 1);
    expect(h.theta.length).toBe(1);
    expect(h.live.thetaAgeMs()).toBe(0);
    // Pong duplikat tidak boleh masuk seri; estimateOffset akan menimangnya dua kali.
    // nonce 1 adalah ping yang barusan dijawab — entri pending-nya sudah dihapus, jadi yang
    // ini dibuang. (nonce 0 masih menunggu dan sengaja tidak dijawab di sini.)
    ws.frame({ t: 'pong', nonce: 1, t1: T0 + 1_000, t2: T0 + 1_620, t3: T0 + 1_623, t4: T0 + 1_040 });
    expect(h.live.sampleCount()).toBe(1);
    expect(h.theta.length).toBe(1);
    ws.emit('close', { code: 1006 });
  });

  it('NUDGE_ONLY: θ yang bergeser 40 kali tidak pernah mengirim satu frame pun ke server', () => {
    // ADR-0001 memberi NUDGE_ONLY arti yang bisa diuji: koreksi fase adalah urusan engine lokal,
    // dan tidak ada jalurnya yang boleh mengubah grid bersama. Kalau suatu saat servo dikirim
    // frame `tempo` untuk meratakan fase, test ini yang meneriakinya — dua belas HP tidak boleh
    // punya dua belas dirigen.
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    ws.frame({ t: 'state', bpm: 120, anchorMs: T0 + 3_000, running: true, members: 1 });
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(1_000);
      answerPing(ws, 600 + i * 3);
    }
    const jenis = ws.sent.map((s) => (JSON.parse(s) as { t: string }).t);
    expect(jenis.filter((t) => t !== 'hello' && t !== 'ping')).toEqual([]);
    expect(h.states[h.states.length - 1]).toEqual({ bpm: 120, anchorMs: T0 + 3_000, running: true });
    expect(h.theta.length).toBeGreaterThan(30);
  });

  it('ping yang tidak dijawab tidak menghasilkan sampel', () => {
    const h = harness();
    h.live.connect();
    h.ws().open();
    vi.advanceTimersByTime(5_000);
    expect(h.live.sampleCount()).toBe(0);
    expect(h.live.thetaMs()).toBe(0);
    expect(h.status.join(' ')).toMatch(/hilang/);
  });

  it('jendela sampel membuang yang lebih tua dari 32 pong', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(1_000);
      answerPing(ws, 600 + i);
    }
    // Tanpa pembuangan ini, satu sampel ber-delay kecil dari 40 detik lalu mengunci θ
    // dan HP terus membunyikan klik pada waktu yang salah.
    expect(h.live.sampleCount()).toBe(32);
    ws.emit('close', { code: 1006 });
  });

  it('putus koneksi: freewheel dan menyambung lagi dengan backoff', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    ws.frame({ t: 'welcome', sid: 'ABCD', members: 1, serverNow: T0 + 657 });
    vi.advanceTimersByTime(1_000);
    answerPing(ws);
    ws.emit('close', { code: 1006 });
    expect(h.status.join(' ')).toMatch(/klik jalan terus/);
    // Sampel dibuang saat putus (lihat close()), jadi θ jatuh ke seed jam server — bukan
    // nol. Klik yang menerbangkan θ = 0 masuk telat 657 ms, lebih dari satu beat.
    expect(h.live.thetaMs()).toBe(657);
    expect(FakeWS.instances.length).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeWS.instances.length).toBe(2);
    h.ws().emit('close', { code: 1006 });
    vi.advanceTimersByTime(1_000);
    expect(FakeWS.instances.length).toBe(2); // backoff ke-2 = 2 detik, belum waktunya
    vi.advanceTimersByTime(1_000);
    expect(FakeWS.instances.length).toBe(3);
  });

  it('tombol saat terputus tidak pura-pura terkirim', () => {
    const h = harness();
    h.live.connect();
    const ws = h.ws();
    ws.open();
    expect(h.live.transport(true)).toBe(true);
    expect(JSON.parse(ws.sent[ws.sent.length - 1]!).t).toBe('start');
    expect(h.live.tempo(96)).toBe(true);
    expect(JSON.parse(ws.sent[ws.sent.length - 1]!).bpm).toBe(96);
    ws.emit('close', { code: 1006 });
    expect(h.live.transport(false)).toBe(false);
    expect(h.status.join(' ')).toMatch(/tidak terkirim/);
  });

  it('close() berhenti mencoba menyambung kembali', () => {
    const h = harness();
    h.live.connect();
    h.ws().open();
    h.live.close();
    vi.advanceTimersByTime(120_000);
    expect(FakeWS.instances.length).toBe(1);
  });
});
