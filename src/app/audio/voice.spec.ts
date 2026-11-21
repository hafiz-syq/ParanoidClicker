import { describe, expect, it } from 'vitest';
import { gridOf } from '../../shared/tempo';
import { countInPlan } from './voice';

// "Intro… one… two… three… four" hanya berguna kalau kata-katanya jatuh di downbeat dan
// ketukan yang benar. Itu aritmetika, jadi diuji tanpa speaker.

describe('countInPlan', () => {
  it('mulai di downbeat berikutnya, lalu satu kata per beat', () => {
    const grid = gridOf(120, 1_000); // beat 0 = 1000 ms, periode 500 ms
    // Sekarang = beat 2,3 (2150 ms): downbeat berikutnya adalah beat 4 = 3000 ms.
    const plan = countInPlan(grid, 2_150);
    expect(plan.map((p) => p.text)).toEqual(['Intro', 'one', 'two', 'three', 'four']);
    expect(plan.map((p) => p.atMs)).toEqual([3_000, 3_500, 4_000, 4_500, 5_000]);
    // Lima ketuk: "Intro" + empat hitungan. Band masuk pada downbeat sesudah kata terakhir.
    expect(plan.length).toBe(5);
  });

  it('tidak pernah mulai di tengah bar, walau sekarang tepat satu beat sebelum downbeat', () => {
    const grid = gridOf(100, 0); // periode 600 ms, downbeat tiap 2400 ms
    for (const now of [0, 1, 599, 600, 2_399, 2_400, 2_401, 3_599]) {
      const plan = countInPlan(grid, now);
      const start = plan[0]!.atMs;
      const beat = (start % 2_400) / 600;
      expect(beat, `now=${now} harus mendarat di downbeat`).toBe(0);
      expect(start).toBeGreaterThanOrEqual(now);
    }
  });

  it('tanpa intro tidak ada kata tambahan, dan jaraknya tetap satu periode', () => {
    const grid = gridOf(90, 500);
    const plan = countInPlan(grid, 1_000, '');
    expect(plan.map((p) => p.text)).toEqual(['one', 'two', 'three', 'four']);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.atMs - plan[i - 1]!.atMs).toBeCloseTo(grid.periodMs, 6);
    }
  });

  it('grid cacat tidak menghasilkan jadwal (setTimeout(NaN) menyala seketika)', () => {
    expect(countInPlan({ anchorMs: 0, periodMs: Number.POSITIVE_INFINITY }, 0)).toEqual([]);
    expect(countInPlan({ anchorMs: 0, periodMs: 0 }, 0)).toEqual([]);
    expect(countInPlan({ anchorMs: Number.NaN, periodMs: 500 }, 0)).toEqual([]);
  });
});
