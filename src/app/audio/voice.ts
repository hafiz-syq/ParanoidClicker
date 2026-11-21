import { beatIndexAt, beatMs, nextBeatMs, type Grid } from '../../shared/tempo';
import { BEATS_PER_BAR } from '../sync/schedule';

/**
 * Hitungan masuk ("Intro… one… two… three… four"). Yang dihitung di sini hanya KAPAN tiap
 * penanda jatuh di jam server dan label yang ditampilkan; bunyinya dijadwalkan oleh
 * `ClickEngine.scheduleCountIn()` di AudioContext yang sama dengan klik. Pemisahan itu
 * disengaja: jadwal murni bisa diuji tanpa speaker, dan tidak ada lagi jam kedua dari
 * `speechSynthesis` yang bisa menggeser kata antar HP.
 */
export const COUNT_WORDS = ['one', 'two', 'three', 'four'] as const;

export interface Stroke {
  /** Waktu server (ms epoch) saat kata ini seharusnya terdengar. */
  atMs: number;
  text: string;
}

/**
 * `Intro` di downbeat berikutnya, lalu one..four pada empat beat sesudahnya. Downbeat yang
 * dipakai, bukan beat berikutnya apa adanya: hitungan yang mulai di tengah bar menaruh "one"
 * satu atau dua ketuk dari tempat band mengharapkannya, dan itu satu-satunya hal yang didengar.
 */
export function countInPlan(grid: Grid, serverNowMs: number, intro = 'Intro'): Stroke[] {
  // Grid cacat (periode tak hingga / negatif) tidak boleh menghasilkan jadwal: tanpa penjaga
  // ini, `start + i * Infinity` menghasilkan NaN dan setTimeout(NaN) menyala seketika.
  if (!Number.isFinite(grid.periodMs) || grid.periodMs <= 0 || !Number.isFinite(grid.anchorMs)) return [];
  const next = nextBeatMs(grid, serverNowMs);
  const bar = Math.ceil(beatIndexAt(grid, next) / BEATS_PER_BAR) * BEATS_PER_BAR;
  const start = beatMs(grid, bar);
  const out: Stroke[] = intro ? [{ atMs: start, text: intro }] : [];
  COUNT_WORDS.forEach((text, i) => out.push({ atMs: start + (i + 1) * grid.periodMs, text }));
  return out;
}
