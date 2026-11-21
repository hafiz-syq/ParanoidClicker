import { describe, expect, it } from 'vitest';
import { laporanDrift, type DriftSample } from './audio-drift';

const START = 1_798_000_000_000;
const STEP_MS = 2_000;
const DURATION_MS = 20 * 60_000;

/** Garis jam audio→server dengan slope yang diketahui. */
function series(slope = 1.0001, offsetMs = 37, rttMs = 10): DriftSample[] {
  const out: DriftSample[] = [];
  for (let audioMs = 0; audioMs <= DURATION_MS; audioMs += STEP_MS) {
    out.push({
      audioMs: 1_234_567 + audioMs,
      serverMs: START + offsetMs + audioMs * slope,
      rttMs,
    });
  }
  return out;
}

describe('laporanDrift', () => {
  it('menghitung slope, ppm, dan ms/menit dari jam audio yang lebih lambat', () => {
    const r = laporanDrift(series(1.0001));
    expect(r.fit).not.toBeNull();
    expect(r.fit!.slope).toBeCloseTo(1.0001, 9);
    expect(r.fit!.ppm).toBeCloseTo(100, 3);
    expect(r.fit!.msPerMinute).toBeCloseTo(6, 5);
    expect(r.fit!.residualP95Ms).toBeLessThan(0.0001);
    expect(r.durationMs).toBeCloseTo(DURATION_MS * 1.0001, 0);
    expect(r.totalDriftMs).toBeCloseTo(120.012, 2);
    expect(r.used).toBe(r.n);
  });

  it('menghasilkan drift negatif saat jam audio lebih cepat', () => {
    const r = laporanDrift(series(0.9999));
    expect(r.fit!.msPerMinute).toBeCloseTo(-6, 5);
    expect(r.fit!.ppm).toBeCloseTo(-100, 3);
  });

  it('membuang separuh RTT terburuk tanpa membuang laju jam', () => {
    const clean = series(1.0002);
    const noisy = series(1.0002).map((s, i) =>
      i % 5 === 0 ? { ...s, serverMs: s.serverMs + 1_000, rttMs: 900 } : s
    );
    const r = laporanDrift(noisy);
    expect(r.n).toBe(noisy.length);
    expect(r.used).toBeLessThan(r.n);
    // Tanpa filter, 20% sampel +1 detik akan menyeret slope. Dengan filter, tetap 12 ms/menit.
    expect(r.fit!.msPerMinute).toBeCloseTo(12, 4);
    expect(clean.length).toBe(noisy.length);
  });

  it('menyusun kumulatif per menit dan delta antarmenit', () => {
    const r = laporanDrift(series(1.0001));
    expect(r.bins.length).toBe(20);
    expect(r.bins[0].count).toBeGreaterThan(20);
    expect(r.bins[0].cumulativeMs).toBeCloseTo(0, 6);
    expect(r.bins[0].deltaMs).toBeNull();
    expect(r.bins[1].cumulativeMs).toBeCloseTo(6, 1);
    expect(r.bins[1].deltaMs).toBeCloseTo(6, 1);
    expect(r.bins[19].cumulativeMs).toBeCloseTo(114, 1);
  });

  it('sampel kosong atau terlalu sedikit tidak menghasilkan fit palsu', () => {
    expect(laporanDrift([]).fit).toBeNull();
    expect(laporanDrift(series().slice(0, 5)).fit).toBeNull();
    expect(laporanDrift(series().slice(0, 5)).bins.length).toBeGreaterThan(0);
  });

  it('mencatat sampel yang dibuang dan hilang di laporan', () => {
    const r = laporanDrift(series(), 3, 2);
    expect(r.rejected).toBe(3);
    expect(r.lost).toBe(2);
  });

  it('sampel dengan timestamp rusak tidak masuk fit', () => {
    const sample = series();
    sample[10] = { ...sample[10], audioMs: Number.NaN };
    sample[20] = { ...sample[20], rttMs: -1 };
    const r = laporanDrift(sample);
    expect(r.n).toBe(sample.length);
    expect(r.used).toBeLessThan(sample.length);
    expect(r.fit!.msPerMinute).toBeCloseTo(6, 4);
  });
});
