import { describe, expect, it } from 'vitest';
import { SERVO_LEVELS, SERVO_SNAP_MS, servoAdvance, servoIdle, servoSetTarget } from './servo';

// Angka 4 bukan selera: tabel keputusan M0 (README) menutup gerbangnya pada jitter p95 ≤ 15 ms
// dan menyimpulkan "servo 4 tingkat cukup". Field p95 = 2,0 ms → satu tingkat ≤ 0,5 ms, yaitu di
// bawah ambang dengar. Mengubah angka ini = ADR-0001 harus ditulis ulang, bukan test ini.
describe('servo 4 tingkat (ADR-0001)', () => {
  it('SERVO_LEVELS terkunci di 4', () => {
    expect(SERVO_LEVELS).toBe(4);
  });

  it('koreksi 8 ms dipecah tepat 4 tingkat dan mendarat tanpa sisa', () => {
    let s = servoIdle(0);
    const r = servoSetTarget(s, 8, 500);
    expect(r.jumped).toBe(false);
    expect(r.servo.stepMs).toBeCloseTo(8 / 4, 9);
    const langkah: number[] = [];
    s = r.servo;
    for (let i = 0; i < SERVO_LEVELS; i++) {
      s = servoAdvance(s);
      langkah.push(s.appliedMs);
    }
    expect(langkah).toEqual([2, 4, 6, 8]);
    expect(s.stepMs).toBe(0);
    // Tingkat kelima tidak boleh menggeser apa pun: servo diam = tidak ada getaran tambahan.
    expect(servoAdvance(s).appliedMs).toBe(8);
  });

  it('arah negatif dilayani sama persis, dan tidak pernah melewati target', () => {
    let s = servoIdle(0);
    s = servoSetTarget(s, -8, 500).servo;
    const lintasan: number[] = [];
    for (let i =0; i < 6; i++) {
      s = servoAdvance(s);
      lintasan.push(s.appliedMs);
    }
    expect(lintasan).toEqual([-2, -4, -6, -8, -8, -8]);
  });

  it('target baru di tengah ramp disusun ulang dari posisi sekarang, bukan dari angka lama', () => {
    // Pong berikutnya mendarat 2 tingkat sebelum yang lama selesai — ini yang terjadi 1 Hz
    // selama lagu, dan jalur yang membuat servo bebas ber-osilasi kalau step lama dipakai terus.
    let s = servoSetTarget(servoIdle(0), 8, 500).servo;
    s = servoAdvance(s);
    s = servoAdvance(s);
    expect(s.appliedMs).toBe(4);
    s = servoSetTarget(s, 1, 500).servo;
    const lintasan: number[] = [];
    for (let i = 0; i < SERVO_LEVELS; i++) {
      s = servoAdvance(s);
      lintasan.push(s.appliedMs);
      expect(s.appliedMs).toBeGreaterThanOrEqual(1); // 4 → 1 turun: tidak pernah di bawah target
    }
    expect(lintasan[SERVO_LEVELS - 1]).toBe(1);
  });

  it('kesalahan di bawah resolusi Date.now langsung dilalap, bukan diagak 4 tingkat', () => {
    const r = servoSetTarget(servoIdle(0), 0.4, 500);
    expect(r.servo.appliedMs).toBe(0.4);
    expect(r.servo.stepMs).toBe(0);
    expect(r.jumped).toBe(false);
    expect(SERVO_SNAP_MS).toBeLessThan(1);
  });

  it('θ yang lebih dari setengah periode dilompat sekaligus dan dilaporkan sebagai lompatan', () => {
    // 657 ms adalah θ lapangan HP #1 (README, 13 Nov 2026) pada 120 bpm (periode 500 ms).
    // Diramp = HP main 100 ms dalam fase yang salah dan seluruh band mendengar satu orang tertinggal.
    const r = servoSetTarget(servoIdle(0), 657, 500);
    expect(r.jumped).toBe(true);
    expect(r.servo.appliedMs).toBe(657);
    expect(r.servo.stepMs).toBe(0);
    // 249 ms pada periode 500 masih di bawah setengah periode → tetap jalur bertingkat.
    expect(servoSetTarget(servoIdle(0), 249, 500).jumped).toBe(false);
  });

  it('grid rusak tidak memicu lompatan', () => {
    // periodMs Infinity adalah keadaan yang benar-benar terjadi sebelum frame `state` pertama
    // (dan kalau bpm:0 lolos); menjadikannya "lompatan" membuat stat `lompat θ` berteriak wolf.
    for (const periodMs of [Number.POSITIVE_INFINITY, 0, -500, Number.NaN]) {
      const r = servoSetTarget(servoIdle(0), 1_000, periodMs);
      expect(r.jumped).toBe(false);
      expect(r.servo.stepMs).toBe(250);
    }
  });

  it('target NaN atau Infinity dibuang, servo tetap di tempat', () => {
    // estimateOffset mengembalikan NaN untuk sampel kosong; server yang mengirim angka hancur
    // tidak boleh membuat klik berpindah ke mana pun.
    for (const target of [Number.NaN, Number.POSITIVE_INFINITY, Number('x')]) {
      const s = servoIdle(5);
      const r = servoSetTarget(s, target, 500);
      expect(r.servo).toEqual(s);
      expect(r.jumped).toBe(false);
    }
  });

  it('empat tingkat selesai dalam 100 ms pada TICK_MS 25', () => {
    // Kontrak ADR-0001: koreksi jitter harus lebih cepat dari satu pong (1 Hz), kalau tidak
    // servo hanya memindahkan kesalahan ke ping berikutnya.
    expect(SERVO_LEVELS * 25).toBeLessThan(1_000);
  });
});
