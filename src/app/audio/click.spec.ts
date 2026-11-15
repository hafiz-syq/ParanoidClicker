import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beatMs, gridOf, periodOf, retune, type Grid } from '../../shared/tempo';
import { ClickEngine, type ClickStats } from './click';

// Harness AudioContext palsu. Yang ditiru hanya jam dan antrean oscillator, karena itulah
// dua hal yang menentukan apakah sebuah klik berbunyi pada beat yang benar. `rate` dibuat
// dari Date.now() supaya jam audio dan jam dinding tidak pernah bisa saling lepas — dua
// jam yang berbohong satu sama lain adalah bug yang tidak boleh lolos ke test.
const BASE_LATENCY_MS = 10;
const OUTPUT_LATENCY_MS = 20;
const COMP = BASE_LATENCY_MS + OUTPUT_LATENCY_MS;
const T0 = 1_794_000_000_000;

class FakeOsc {
  type = 'sine';
  frequency: { value: number } = { value: 0 };
  onended: (() => void) | null = null;
  startAudioMs = Number.NaN;
  private stopAudioMs = Number.NaN;

  constructor(private readonly ctx: FakeAudioContext) {}

  connect(dest: unknown): unknown {
    return dest;
  }

  disconnect(): void {}

  start(t: number): void {
    this.startAudioMs = t * 1000;
  }

  stop(t: number): void {
    this.stopAudioMs = t * 1000;
    const dueWallMs = this.ctx.wallMsOf(this.stopAudioMs);
    setTimeout(() => this.onended?.(), Math.max(0, Math.ceil(dueWallMs - Date.now())));
  }
}

class FakeAudioContext {
  static created: FakeAudioContext[] = [];

  state: string = 'running';
  readonly sampleRate = 48_000;
  readonly baseLatency = BASE_LATENCY_MS / 1000;
  readonly outputLatency = OUTPUT_LATENCY_MS / 1000;
  readonly destination = {};
  readonly armed: FakeOsc[] = [];
  /** Jam audio tidak 1,00 di semua peramban: headless 2,3×, tab di-throttle 0,993× (README). */
  rate = 1;
  private readonly zeroWallMs = Date.now();

  constructor() {
    FakeAudioContext.created.push(this);
  }

  get currentTime(): number {
    return this.audioMs / 1000;
  }

  get audioMs(): number {
    return (Date.now() - this.zeroWallMs) * this.rate;
  }

  wallMsOf(audioMs: number): number {
    return this.zeroWallMs + audioMs / this.rate;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createOscillator(): FakeOsc {
    const osc = new FakeOsc(this);
    this.armed.push(osc);
    return osc;
  }

  createGain(): { gain: { [k: string]: unknown }; connect: (d: unknown) => unknown; disconnect: () => void } {
    return {
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (d: unknown) => d,
      disconnect: () => undefined,
    };
  }
}

/** Hasil ukur satu klik, dikembalikan ke waktu server tempat grid-nya hidup. */
interface Hit {
  index: number;
  /** Berapa milidetik bunyi ini meleset dari beat grid — angka yang didengar personil. */
  residualMs: number;
  /** Waktu bunyi dalam ms RELATIF ke T0, supaya ambang di test bisa dibaca sebagai detik. */
  soundMs: number;
}

function soundMs(ctx: FakeAudioContext, osc: FakeOsc): number {
  return ctx.wallMsOf(osc.startAudioMs) + COMP - T0;
}

function hits(ctx: FakeAudioContext, grid: Grid, thetaTrueMs: number): Hit[] {
  return ctx.armed.map((osc) => {
    // Relatif → absolut: θ_true dipakai apa adanya karena anchor grid ikut skala absolut.
    const serverAt = ctx.wallMsOf(osc.startAudioMs) + COMP + thetaTrueMs;
    const round = Math.round((serverAt - grid.anchorMs) / grid.periodMs);
    // -0 vs +0: Object.is memisahkan keduanya, dan residual sekecil apa pun boleh membulatkan ke -0.
    return { index: round === 0 ? 0 : round, residualMs: serverAt - beatMs(grid, round), soundMs: soundMs(ctx, osc) };
  });
}

function engine(): { e: ClickEngine; stats: ClickStats[]; ctx: FakeAudioContext } {
  const stats: ClickStats[] = [];
  const e = new ClickEngine({ onStats: (s) => stats.push(s) });
  void e.unlock();
  const ctx = FakeAudioContext.created[FakeAudioContext.created.length - 1];
  return { e, stats, ctx };
}

function pump(ms: number): void {
  // 5 ms: cukup halus untuk melihat onended mendarat di waktu due-nya, dan 25 masih kelipatan.
  for (let i = 0; i < ms / 5; i++) vi.advanceTimersByTime(5);
}

const last = (s: ClickStats[]): ClickStats => s[s.length - 1];

beforeEach(() => {
  FakeAudioContext.created = [];
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// 3 detik: satu jendela ukur laju (RATE_WINDOW_MS) ditambah margin, supaya yang diuji adalah
// servo dan bukan 1 detik pertama saat engine masih mengira jam audio berdetak 1,00.
const WARM = 3_000;

describe('ClickEngine + servo (ADR-0001)', () => {
  it('θ yang baru dipakai seutuhnya sebelum satu beat pun disetel', async () => {
    // 657 ms adalah θ lapangan HP #1. Diramp di sini = klik pertama datang telat 493 ms,
    // dan itu persis keluhan "kliknya beda sendiri" yang ditulis di kepala click.ts.
    const { e, ctx } = engine();
    const grid = gridOf(120, Date.now() + 657 + 300);
    e.setTheta(657);
    e.setGrid(grid);
    pump(2_000);
    for (const h of hits(ctx, grid, 657)) expect(h.residualMs).toBeCloseTo(0, 6);
    e.destroy();
  });

  describe.each([1, 0.993, 2.3])('laju audio %s×', (rate) => {
    it('satu koreksi 12 ms bergerak dalam 4 tingkat, bukan lompatan sekaligus', () => {
      // θ sebenarnya 12 ms sejak awal; engine baru mengetahuinya lewat pong di t=WARM.
      // Yang dituntut telinga: klik sesudah pong tidak pernah terpindah lebih dari 12/4 ms
      // dari klik sebelumnya, lalu mendarat di grid.
      const { e, stats, ctx } = engine();
      ctx.rate = rate;
      const grid = gridOf(120, Date.now() + 300);
      e.setTheta(0);
      e.setGrid(grid);
      pump(WARM);
      e.setTheta(12);
      const theta: number[] = [];
      for (let i = 0; i < 4; i++) {
        pump(25);
        theta.push(last(stats).thetaMs);
      }
      // Hari ini: satu tick sudah 12. Setelah servo: 3, 6, 9, 12 — dan tingkat keempat mendarat
      // tepat di target tanpa sisa.
      expect(theta).toEqual([3, 6, 9, 12]);
      // Klik sesudah servo selesai: 1,5 detik supaya ada beberapa beat yang bisa dibandingkan.
      pump(1_500);
      const semua = hits(ctx, grid, 12);
      const sebelum = semua.filter((h) => h.soundMs <= WARM);
      const sesudah = semua.filter((h) => h.soundMs > WARM);
      // Sebelum pong: 12 ms terlambat, karena θ yang lama (0) dipakai untuk konversi jam.
      for (const h of sebelum.slice(-3)) expect(h.residualMs).toBeCloseTo(12, 6);
      const langkah: number[] = [];
      for (let i = 1; i < sesudah.length; i++) langkah.push(Math.abs(sesudah[i].residualMs - sesudah[i - 1].residualMs));
      expect(langkah.length).toBeGreaterThan(1);
      for (const d of langkah) expect(d).toBeLessThanOrEqual(12 / 4 + 1e-6);
      expect(sesudah[sesudah.length - 1].residualMs).toBeCloseTo(0, 6);
      e.destroy();
    });

    it('klik tetap jatuh di grid dan tidak ada yang hilang setelah servo selesai', () => {
      const { e, stats, ctx } = engine();
      ctx.rate = rate;
      const grid = gridOf(120, Date.now() + 300);
      e.setTheta(0);
      e.setGrid(grid);
      pump(WARM);
      const hilangSebelum = last(stats).missed;
      e.setTheta(11);
      pump(2_000);
      const p = last(stats);
      // Gerbang M2: servo yang memperbaiki fase tapi mengorbankan `0 hilang` itu regresi.
      expect(p.missed).toBe(hilangSebelum);
      const klik = hits(ctx, grid, 11).filter((h) => h.soundMs > WARM + 250);
      const indeks = klik.map((h) => h.index);
      for (let i = 1; i < indeks.length; i++) expect(indeks[i]).toBe(indeks[i - 1] + 1);
      for (const h of klik.slice(4)) expect(h.residualMs).toBeCloseTo(0, 6);
      e.destroy();
    });
  });

  it('dua engine pada satu grid server: indeks beat identik walau servo bekerja ke arah berlawanan', () => {
    // Pelajaran T6: satu socket + satu grid yang di-mock tidak menangkap apa pun. Dua HP nyata
    // punya θ yang berbeda dan koreksi yang berbeda arahnya; yang tidak boleh berbeda adalah
    // beat mana yang mereka bunyikan.
    const grid = gridOf(120, Date.now() + 300);
    const a = engine();
    const b = engine();
    for (const h of [a, b]) {
      h.e.setTheta(0);
      h.e.setGrid(grid);
    }
    pump(WARM);
    a.e.setTheta(12);
    b.e.setTheta(-12);
    pump(5_000);
    const klikA = hits(a.ctx, grid, 12).filter((h) => h.soundMs > WARM + 250).map((h) => h.index);
    const klikB = hits(b.ctx, grid, -12).filter((h) => h.soundMs > WARM + 250).map((h) => h.index);
    expect(klikA.length).toBeGreaterThan(8);
    expect(klikB).toEqual(klikA);
    expect(last(a.stats).missed).toBe(0);
    expect(last(b.stats).missed).toBe(0);
    // anchor yang dipakai keduanya adalah objek grid yang sama — dan tidak ada satu pun engine
    // yang menulis angkanya.
    expect(grid.anchorMs).toBe(T0 + 300);
    expect(last(a.stats).thetaMs).toBe(12);
    expect(last(b.stats).thetaMs).toBe(-12);
    a.e.destroy();
    b.e.destroy();
  });

  it('lompatan lebih dari setengah periode tercatat di stat, tidak diam-diam', () => {
    const { e, stats, ctx } = engine();
    const grid = gridOf(120, Date.now() + 300);
    e.setTheta(0);
    e.setGrid(grid);
    pump(WARM);
    expect(last(stats).thetaJumps).toBe(0);
    e.setTheta(400); // > setengah periode 120 bpm (250 ms) → jalur pemulihan, sekali lompat
    pump(25);
    expect(last(stats).thetaMs).toBe(400);
    expect(last(stats).thetaJumps).toBe(1);
    for (const h of hits(ctx, grid, 400).filter((x) => x.soundMs > WARM + 500)) {
      expect(h.residualMs).toBeCloseTo(0, 6);
    }
    e.destroy();
  });

  it('frame yang datang sebelum anchor tidak memotong beat grid lama di antaranya', () => {
    // Aturan serah terima (ADR-0004). Yang ini jalur paling sering di lapangan: pemimpin
    // menekan tombol, frame `state` mendarat, dan anchor-nya masih 2,3 detik di depan. Semua
    // beat grid lama yang belum sempat diantre di antara keduanya adalah klik yang akan
    // berbunyi — adopsi langsung membuangnya tanpa meninggalkan angka di `hilang` atau
    // `tertelan`, karena keduanya mengukur hal lain.
    const { e, stats, ctx } = engine();
    const lama = gridOf(120, Date.now() + 300);
    e.setTheta(0);
    e.setGrid(lama);
    pump(1_000);
    e.setGrid(retune(lama, 60, Date.now() + 2_000)); // anchor 3300 ms, satu bar penuh di depan
    pump(4_000);
    const bunyi = ctx.armed.map((o) => soundMs(ctx, o));
    for (const t of [1_300, 1_800, 2_300, 2_800]) {
      expect(bunyi.some((ms) => Math.abs(ms - t) < 1)).toBe(true);
    }
    // Ekor antrean grid lama sudah memegang 3300 ms (jahitannya adalah beat grid lama), jadi
    // grid baru mulai dari beat 1 dan momen itu hanya berbunyi sekali.
    expect(bunyi.filter((ms) => ms >= 3_200)).toEqual([3_300, 4_300]);
    expect(last(stats).missed).toBe(0);
    expect(last(stats).swallowed).toBe(0);
    e.destroy();
  });

  it('jahitan yang mendarat terlambat melaporkan beat tertelan sebagai angka, bukan nol', () => {
    // Grid lama (120 bpm, anchor 300) sudah menyetel beat 2300 ms pada saat frame `state`
    // baru mendarat di 2200 ms. Beat grid 90 bpm pada 2250 ms jatuh di dalam sisa antrean
    // dan DIBUANG. Yang tidak boleh: angka `hilang` tetap 0 sambil menyembunyikannya.
    const { e, stats, ctx } = engine();
    const lama = gridOf(120, Date.now() + 300);
    e.setTheta(0);
    e.setGrid(lama);
    pump(2_200);
    const baru = gridOf(90, Date.now() + 50);
    e.setGrid(baru);
    pump(2_000);
    const p = last(stats);
    expect(p.swallowed).toBe(1);
    expect(p.missed).toBe(0);
    const server = ctx.armed.map((o) => soundMs(ctx, o));
    expect(server.some((ms) => Math.abs(ms - 2_250) < 1)).toBe(false);
    expect(server.some((ms) => Math.abs(ms - 2_300) < 1)).toBe(true);
    e.destroy();
  });

  it('servo bekerja 20 detik tanpa pernah menyentuh grid dan tanpa klik ganda (NUDGE_ONLY)', () => {
    // ADR-0001: servo adalah jalur koreksi fase murni. Yang berhak mengubah grid bersama
    // hanyalah pemimpin, lewat frame `tempo`. Kalau servo diam-diam mengadopsi grid ulang,
    // dua belas HP dapat dua belas versi kebenaran dan tidak ada angka yang menunjukkannya.
    const { e, stats, ctx } = engine();
    const grid = gridOf(120, Date.now() + 300);
    const anchor = grid.anchorMs;
    e.setTheta(0);
    e.setGrid(grid);
    for (let i = 0; i < 40; i++) {
      e.setTheta(((i * 37) % 15) - 7);
      pump(500);
    }
    expect(grid).toEqual({ anchorMs: anchor, periodMs: periodOf(120) });
    const klik = hits(ctx, grid, 0);
    const waktu = klik.map((h) => Math.round(h.soundMs * 1000) / 1000);
    expect(new Set(waktu).size).toBe(waktu.length);
    expect(last(stats).missed).toBe(0);
    e.destroy();
  });

  it('ramp per bar tidak membuat engine kehilangan atau menggandakan satu klik pun', () => {
    // Sisi klien dari ADR-0002: grid-nya datang dari `retune` dengan LEAD_MS, seperti yang
    // dihitung SessionDO, dan engine harus mengikutinya tanpa lubang di jahitan.
    const { e, stats, ctx } = engine();
    let grid = gridOf(120, Date.now() + 300);
    e.setTheta(0);
    e.setGrid(grid);
    for (let bpm = 119; bpm >= 110; bpm--) {
      pump(2_000);
      grid = retune(grid, bpm, Date.now() + 300);
      e.setGrid(grid);
    }
    pump(2_000);
    expect(last(stats).missed).toBe(0);
    expect(last(stats).swallowed).toBe(0);
    const server = ctx.armed.map((o) => soundMs(ctx, o));
    for (let i = 1; i < server.length; i++) {
      expect(server[i] - server[i - 1]).toBeGreaterThan(1);
      expect(server[i] - server[i - 1]).toBeLessThanOrEqual(periodOf(110) * 1.05 + 1);
    }
    e.destroy();
  });

  it('tab beku 3 detik lalu frame baru: klik yang bolong terhitung, bukan ditumpuk sekaligus', () => {
    const { e, stats, ctx } = engine();
    const grid = gridOf(120, Date.now() + 300);
    e.setTheta(0);
    e.setGrid(grid);
    pump(1_000);
    const sebelum = last(stats).played;
    // Layar tidur: konteks dibekukan OS, jam dinding jalan terus, tick tetap lahir.
    ctx.state = 'suspended';
    pump(3_000);
    ctx.state = 'running';
    pump(250);
    e.setGrid(retune(grid, 120, Date.now() + 300));
    pump(500);
    const p = last(stats);
    expect(p.missed).toBeGreaterThanOrEqual(6);
    // Beat yang lewat selama tidur tidak pernah dibunyikan beruntun sesudahnya: antar klik
    // sesudah bangun tetap berjarak, bukan satu tembakan salvo.
    const bunyi = ctx.armed.map((o) => soundMs(ctx, o)).filter((ms) => ms > 4_000);
    expect(bunyi.length).toBeGreaterThan(0);
    for (let i = 1; i < bunyi.length; i++) expect(bunyi[i] - bunyi[i - 1]).toBeGreaterThan(100);
    expect(p.played).toBeGreaterThan(sebelum);
    e.destroy();
  });
});
