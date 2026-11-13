import { expect, it } from 'vitest';
import {
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  beatIndexAt,
  beatMs,
  gridOf,
  nextBeatMs,
  parseBpm,
  periodOf,
  retune,
  type Grid,
} from './tempo';

const A0 = 1_700_000_000_000;

const batasDiEntre = (grid: Grid, from: number, to: number): number => {
  let n = 0;
  for (let i = beatIndexAt(grid, from) - 1; i <= beatIndexAt(grid, to) + 1; i++) {
    const at = beatMs(grid, i);
    if (at > from && at < to) n++;
  }
  return n;
};

it('parseBpm hanya menerima bilangan bulat di dalam batas', () => {
  expect(parseBpm(120)).toBe(120);
  expect(parseBpm(MIN_BPM)).toBe(MIN_BPM);
  expect(parseBpm(MAX_BPM)).toBe(MAX_BPM);
  expect(parseBpm(DEFAULT_BPM)).toBe(DEFAULT_BPM);
  for (const cacat of [MIN_BPM - 1, MAX_BPM + 1, 137.5, 0, -120, NaN, Infinity, '120', null, undefined, true]) {
    expect(parseBpm(cacat)).toBeNull();
  }
});

it('satu menit tetap 60.000 ms berapa pun temponya', () => {
  expect(periodOf(60)).toBe(1000);
  expect(periodOf(120)).toBe(500);
  expect(periodOf(300)).toBe(200);
});

it('indeks beat tepat di batas, sesaat sesudahnya, dan sebelum anchor', () => {
  const g = gridOf(120, A0);
  expect(beatIndexAt(g, A0)).toBe(0);
  expect(beatIndexAt(g, A0 + 499.999)).toBe(0);
  expect(beatIndexAt(g, A0 + 500)).toBe(1);
  expect(beatIndexAt(g, A0 - 0.001)).toBe(-1);
  expect(beatMs(g, -2)).toBe(A0 - 1000);
});

it('nextBeatMs tidak pernah maju kalau saat ini tepat sebuah beat', () => {
  const g = gridOf(120, A0);
  expect(nextBeatMs(g, A0)).toBe(A0);
  expect(nextBeatMs(g, A0 - 500)).toBe(A0 - 500);
  expect(nextBeatMs(g, A0 + 1)).toBe(A0 + 500);
});

it('retune mendarat di batas grid lama tanpa melewati satu klik pun', () => {
  const old = gridOf(120, A0);
  for (const at of [A0, A0 + 1, A0 + 499, A0 + 500, A0 + 12345.6, A0 - 700]) {
    const next = retune(old, 180, at);
    expect(next.anchorMs).toBeGreaterThanOrEqual(at);
    // Tidak bisa terlambat lebih dari satu beat lama: pemimpin menekan, semua HP bergerak
    // pada klik berikutnya, bukan pada kliknya yang ke-sekian.
    expect(next.anchorMs - at).toBeLessThan(old.periodMs);
    expect(batasDiEntre(old, at, next.anchorMs)).toBe(0);
    // Batas baru harus benar-benar titik grid lama, bukan hanya dekat.
    expect(Number.isInteger((next.anchorMs - A0) / old.periodMs)).toBe(true);
    expect(next.periodMs).toBe(periodOf(180));
    expect(beatIndexAt(next, next.anchorMs)).toBe(0);
  }
});

it('jarak beat tidak menabung galat floating-point walau seratus ribu beat', () => {
  const g = gridOf(49, A0); // 1224,489795918... ms: period yang tidak pernah habis
  const galat = (i: number) => Math.abs(beatMs(g, i + 1) - beatMs(g, i) - periodOf(49));
  // Ulp double pada magnitudo epoch-ms (~1,8e12) = 2^-12 ms = 0,000244 ms, sudah jauh di bawah
  // resolusi Date.now() (1 ms). Batas 1e-3 membedakan perkalian langsung dari `+=` per beat:
  // menjumlah 100.000 period akan menyeret galatnya ke puluhan milidetik.
  expect(galat(1)).toBeLessThan(1e-3);
  expect(galat(100_000)).toBeLessThan(1e-3);
});
