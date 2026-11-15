import { LEAD_MS, MAX_BPM, MIN_BPM, beatIndexAt, beatMs, type Grid } from '../../shared/tempo';
import { BEATS_PER_BAR } from './schedule';

/**
 * Ramp tempo per bar (ADR-0002). Pemimpin hanya mengirim frame `tempo` yang sudah ada,
 * satu langkah tiap bar; seluruh aritmetika jahitan tetap milik server. Jadi tidak ada
 * keadaan baru di ruangan ini selain dua angka di bawah.
 */
export const RAMP_STEP_BPM = 1;

// Frame masih harus mendarat SEBELUM jahitan yang dihitung server: p95 RTT lapangan 99 ms,
// dan kalau terlambat yang diambil beat berikutnya — yang di tengah bar, jadi aksen pindah.
const MIN_SLACK_DIVISOR = 4;

export interface RampState {
  readonly targetBpm: number;
  /** Jahitan yang sudah pernah dikirim; dedupe-nya per momen, bukan per timer. */
  readonly sentSeamMs: number;
}

export interface RampStep {
  readonly state: RampState;
  /** bpm yang harus dikirim sekarang; null = bar ini sudah punya langkah, atau ramp selesai. */
  readonly bpm: number | null;
}

export function rampStart(targetBpm: number): RampState {
  return { targetBpm, sentSeamMs: Number.NEGATIVE_INFINITY };
}

export function rampBpm(from: number, target: number): number {
  // Integer dan 30..300: `parseBpm` di server menolak selain itu, dan satu angka yang ditolak
  // membuat seluruh ruangan berhenti ganti tempo.
  const goal = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(target)));
  if (goal === from) return from;
  const next = from + (goal > from ? RAMP_STEP_BPM : -RAMP_STEP_BPM);
  return Math.abs(goal - next) < RAMP_STEP_BPM ? goal : next;
}

/**
 * Jahitan yang akan dipakai server untuk frame yang dikirim SEKARANG, kalau — dan hanya kalau
 * — jahitan itu jatuh di awal bar. `null` berarti bar ini tidak boleh diputuskan sekarang.
 */
export function barSeamMs(grid: Grid, serverNowMs: number, leadMs = LEAD_MS): number | null {
  if (!Number.isFinite(grid.periodMs) || grid.periodMs <= 0 || !Number.isFinite(grid.anchorMs)) return null;
  const at = serverNowMs + leadMs;
  const index = beatIndexAt(grid, at);
  // Aturan DO persis (retune memakai nextBeatMs): beat berikutnya sesudah `at`, bukan yang
  // setelahnya lagi. Tidak ada scan ke depan di sini, karena server juga tidak menatap ke depan.
  const seamIndex = beatMs(grid, index) >= at ? index : index + 1;
  if (seamIndex % BEATS_PER_BAR !== 0) return null;
  const seam = beatMs(grid, seamIndex);
  return seam - at >= grid.periodMs / MIN_SLACK_DIVISOR ? seam : null;
}

/** Ditanya tiap tick; menghasilkan paling banyak satu permintaan per bar. */
export function rampStep(state: RampState, grid: Grid, serverNowMs: number, currentBpm: number): RampStep {
  const seam = barSeamMs(grid, serverNowMs);
  if (seam === null || seam <= state.sentSeamMs) return { state, bpm: null };
  const next = rampBpm(currentBpm, state.targetBpm);
  // Ramp selesai: angka yang sama tidak perlu dikirim, dan mengirimnya tiap bar hanya
  // membangunkan semua HP untuk tidak mengubah apa pun.
  if (next === currentBpm) return { state, bpm: null };
  return { state: { targetBpm: state.targetBpm, sentSeamMs: seam }, bpm: next };
}
