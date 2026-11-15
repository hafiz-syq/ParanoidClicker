/**
 * Servo koreksi θ (ADR-0001). Pure arithmetic: engine hanya menyimpan satu keadaan ini dan
 * memajukan satu tingkat tiap TICK_MS, jadi lintasan koreksinya bisa diuji tanpa browser dan
 * tanpa Web Audio — termasuk saat jam audio berdetak 0,993× atau 2,3×.
 */
export const SERVO_LEVELS = 4;
// Di bawah resolusi stamp yang dipakai θ (Date.now integer, pong membawa integer) tidak ada
// yang bisa dikoreksi; meramp-nya cuma menambah satu tingkat getaran yang tidak dibutuhkan.
export const SERVO_SNAP_MS = 0.5;

export interface Servo {
  /** θ yang sekarang dipakai klik. Hanya angka ini yang boleh masuk scheduler. */
  appliedMs: number;
  /** θ terakhir yang diukur dari pong; servo bergerak ke sini, tidak pernah sebaliknya. */
  targetMs: number;
  /** Lebar satu tingkat; 0 = servo sudah diam di target. */
  stepMs: number;
}

export function servoIdle(appliedMs: number): Servo {
  return { appliedMs, targetMs: appliedMs, stepMs: 0 };
}

export interface ServoTarget {
  servo: Servo;
  /** true = kesalahan ditutup sekali lompat, bukan 4 tingkat. Harus kelihatan di stat. */
  jumped: boolean;
}

export function servoSetTarget(s: Servo, targetMs: number, periodMs: number): ServoTarget {
  // estimateOffset mengembalikan NaN untuk sampel kosong; angka hancur tidak boleh
  // memindahkan satu klik pun.
  if (!Number.isFinite(targetMs)) return { servo: s, jumped: false };
  const err = targetMs - s.appliedMs;
  if (Math.abs(err) < SERVO_SNAP_MS) return { servo: { appliedMs: targetMs, targetMs, stepMs: 0 }, jumped: false };
  // Lebih dari setengah periode bukan jitter jaringan: itu HP yang baru bangun dari tidur atau
  // jam OS yang dikoreksi NTP. Diramp = seluruh band mendengar satu orang tertinggal 100 ms.
  if (Number.isFinite(periodMs) && periodMs > 0 && Math.abs(err) >= periodMs / 2) {
    return { servo: { appliedMs: targetMs, targetMs, stepMs: 0 }, jumped: true };
  }
  return { servo: { appliedMs: s.appliedMs, targetMs, stepMs: err / SERVO_LEVELS }, jumped: false };
}

/** Majukan satu tingkat. Dipanggil tepat sekali per tick, tidak per pong. */
export function servoAdvance(s: Servo): Servo {
  if (s.stepMs === 0 || s.appliedMs === s.targetMs) return s;
  const rest = s.targetMs - s.appliedMs;
  // Tingkat terakhir mendarat tepat di target: sisa pembulatan tidak boleh tinggal permanen.
  if (Math.abs(rest) <= Math.abs(s.stepMs)) return { appliedMs: s.targetMs, targetMs: s.targetMs, stepMs: 0 };
  return { appliedMs: s.appliedMs + s.stepMs, targetMs: s.targetMs, stepMs: s.stepMs };
}
