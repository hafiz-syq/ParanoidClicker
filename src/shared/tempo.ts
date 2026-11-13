export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const DEFAULT_BPM = 120;

// Batas beat yang akan datang, bukan sekarang: frame `state` harus sempat mendarat di HP
// sebelum beat pertama grid baru jatuh. p95 RTT lapangan HP #1 = 99 ms (README, 13 Nov 2026).
export const LEAD_MS = 300;

/**
 * Grid klik. `anchorMs` adalah waktu server (ms epoch) saat beat 0 jatuh; semua HP menurunkan
 * beat mereka sendiri dari pasangan (anchorMs, bpm) yang sama, jadi tidak ada yang mengirim
 * "tick" per beat ke mana-mana.
 */
export interface Grid {
  anchorMs: number;
  periodMs: number;
}

export function periodOf(bpm: number): number {
  return 60000 / bpm;
}

export function gridOf(bpm: number, anchorMs: number): Grid {
  return { anchorMs, periodMs: periodOf(bpm) };
}

// Integer saja: keypad leader cuma menghasilkan bilangan, dan 137.4 yang masuk lewat jaringan
// akan menggeser grid di semua HP. Number.isInteger sudah menyingkirkan NaN dan Infinity.
export function parseBpm(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= MIN_BPM && value <= MAX_BPM ? value : null;
}

/** Indeks beat yang memayungi `serverMs`. Negatif berarti sebelum anchor: grid berlaku dua arah. */
export function beatIndexAt(grid: Grid, serverMs: number): number {
  return Math.floor((serverMs - grid.anchorMs) / grid.periodMs);
}

export function beatMs(grid: Grid, index: number): number {
  return grid.anchorMs + index * grid.periodMs;
}

/** Batas beat pertama yang jatuh tepat pada atau sesudah `serverMs`. */
export function nextBeatMs(grid: Grid, serverMs: number): number {
  const index = beatIndexAt(grid, serverMs);
  const at = beatMs(grid, index);
  return at >= serverMs ? at : beatMs(grid, index + 1);
}

/**
 * Ganti tempo tanpa pernah menghilangkan atau menggandakan satu klik: grid baru mulai tepat di
 * batas grid lama berikutnya, jadi kedua grid sepakat tentang momen perpindahannya.
 */
export function retune(grid: Grid, bpm: number, atMs: number): Grid {
  return { anchorMs: nextBeatMs(grid, atMs), periodMs: periodOf(bpm) };
}
