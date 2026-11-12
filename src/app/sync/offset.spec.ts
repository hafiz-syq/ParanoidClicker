import { describe, expect, it } from 'vitest';
import {
  estimateJitter,
  estimateOffset,
  median,
  percentile,
  toSample,
  type Sample,
  type Stamps,
} from './offset';

function stampsFrom(offsetMs: number, upMs: number, procMs: number, downMs: number): Stamps {
  const t1 = 1_000_000;
  const t2 = t1 + upMs + offsetMs;
  const t3 = t2 + procMs;
  const t4 = t1 + upMs + procMs + downMs;
  return { t1, t2, t3, t4 };
}

function sampleAt(offsetMs: number, upMs: number, procMs: number, downMs: number): Sample {
  const s = toSample(stampsFrom(offsetMs, upMs, procMs, downMs));
  if (!s) throw new Error('skenario ini harus menghasilkan sampel valid');
  return s;
}

describe('toSample', () => {
  it('jalur simetris mengembalikan offset persis dan RTT tanpa waktu proses server', () => {
    const s = sampleAt(40, 20, 3, 20);
    expect(s.offsetMs).toBeCloseTo(40, 6);
    // 3 ms kerja di server keluar dari RTT justru karena t2 dan t3 dua-duanya cap server.
    expect(s.rttMs).toBeCloseTo(40, 6);
    expect(s.delayMs).toBeCloseTo(20, 6);
  });

  it('asymmetry adalah bias, bukan noise: satu sampel simetris terbalik tanda', () => {
    // Naik 60 ms, turun 4 ms -> estimasi offset tertarik jauh walau RTT-nya normal.
    expect(sampleAt(40, 60, 3, 4).offsetMs).toBeCloseTo(68, 6);
    expect(sampleAt(40, 4, 3, 60).offsetMs).toBeCloseTo(12, 6);
  });

  it('RTT nol/negatif dan cap non-finite menghasilkan null, bukan sampel', () => {
    // (t4-t1) sama kecilnya dengan (t3-t2): RTT 0 berarti tidak ada waktu di jaringan, mustahil.
    expect(toSample({ t1: 1000, t2: 1000, t3: 1020, t4: 1020 })).toBeNull();
    // Jam dinding HP melompat mundur di antara t1 dan t4.
    expect(toSample({ t1: 1000, t2: 1020, t3: 1020, t4: 990 })).toBeNull();
    expect(toSample({ t1: 1e12, t2: 1020, t3: 1020, t4: 1030 })).toBeNull();
    expect(toSample({ t1: NaN, t2: 1020, t3: 1020, t4: 1030 })).toBeNull();
  });

  it('sampel rusak yang dibuang tidak bisa membajak estimasi', () => {
    // Setiap base menghasilkan θ=40 dengan naik=turun=20, proc=0 -> RTT 40.
    const good: Sample[] = [];
    for (let i = 0; i < 24; i++) {
      const base = 1000 + i * 1000;
      const s = toSample({ t1: base, t2: base + 60, t3: base + 60, t4: base + 40 });
      if (s) good.push(s);
    }
    expect(good).toHaveLength(24);
    const corrupt = [
      toSample({ t1: 1000, t2: 1020, t3: 1020, t4: 990 }),
      toSample({ t1: 1e12, t2: 1020, t3: 1020, t4: 1030 }),
    ].filter((s): s is Sample => s !== null);
    // Yang rusak tidak pernah masuk array, jadi θ tetap 40 ms.
    expect(corrupt).toHaveLength(0);
    expect(estimateOffset(good.concat(corrupt))).toBeCloseTo(40, 6);
  });
});

describe('percentile / median', () => {
  it('kosong menghasilkan NaN, tunggal menghasilkan dirinya sendiri', () => {
    expect(percentile([], 0.5)).toBeNaN();
    expect(percentile([7], 1)).toBe(7);
    expect(median([5, 1, 3])).toBe(3);
  });

  it('p95 memilih nilai terbesar ke-k yang benar, bukan rata-rata', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile(values, 1)).toBe(100);
  });

  it('tidak mengubah array milik pemanggil', () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('estimateOffset', () => {
  // Ini uji yang menjaga klaim §3: 1000 sampel, offset 40 ms, 10% kena spike 300 ms.
  it('menembus 10% spike asimetris dan tetap <2 ms dari offset sebenarnya', () => {
    const offset = 40;
    const samples: Sample[] = [];
    let seed = 20_261_113;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 1000; i++) {
      const spiked = rand() < 0.1;
      const up = 15 + rand() * 10;
      const down = 15 + rand() * 10;
      samples.push(sampleAt(offset, up + (spiked ? 300 : 0), 2, down));
    }

    expect(Math.abs(estimateOffset(samples) - offset)).toBeLessThan(2);

    // Rata-rata atas semua sampel kalah jauh — itu alasan filter ini ada.
    const mean = samples.reduce((a, s) => a + s.offsetMs, 0) / samples.length;
    expect(Math.abs(mean - offset)).toBeGreaterThan(8);
  });

  it('sample kosong menghasilkan NaN, sample tunggal dipakai apa adanya', () => {
    expect(estimateOffset([])).toBeNaN();
    expect(estimateOffset([sampleAt(40, 20, 2, 20)])).toBeCloseTo(40, 6);
  });

  it('k lebih besar dari jumlah sampel tidak melempar', () => {
    expect(estimateOffset([sampleAt(10, 20, 2, 20)], 8)).toBeCloseTo(10, 6);
  });
});

describe('estimateJitter', () => {
  it('jalur sempurna stabil menghasilkan jitter nol', () => {
    const steady = Array.from({ length: 40 }, () => sampleAt(40, 20, 2, 20));
    expect(estimateJitter(steady)).toBe(0);
  });

  it('satu spike besar hanya menaikkan jitter sesaat, bukan seluruh seri', () => {
    const steady = Array.from({ length: 40 }, () => sampleAt(40, 20, 2, 20));
    steady[20] = sampleAt(40, 320, 2, 20);
    expect(estimateJitter(steady)).toBeLessThan(1);
  });

  it('butuh minimal dua window penuh, selain itu NaN', () => {
    expect(estimateJitter(Array.from({ length: 15 }, () => sampleAt(0, 20, 2, 20)))).toBeNaN();
  });
});
