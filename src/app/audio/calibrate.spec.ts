import { describe, expect, it } from 'vitest';
import { MAX_DEV_MS, MAX_LATENCY_MS, MIN_LATENCY_MS, acousticLatency, type ClickPair } from './calibrate';

// Tes sintetis: tidak ada mikrofon, speaker, atau perangkat di sini. Yang dijaga cuma satu —
// ringkasan 8 klik tidak boleh bergeser karena satu onset palsu, dan "tidak ada angka" harus
// terbedakan dari "latensi 0 ms".

const pairs = (offsets: number[], sentMs = 10_000): ClickPair[] =>
  offsets.map((d) => ({ sentMs, heardMs: sentMs + d }));

describe('acousticLatency', () => {
  it('K1 — median, bukan rata-rata: satu klik nyasar tidak menggeser angka', () => {
    // 300 ms masih di dalam 0..500, jadi yang membuangnya adalah aturan ±40 ms dari median.
    const e = acousticLatency(pairs([5, 5, 6, 7, 300]));
    expect(e).toEqual({ ms: 6, used: 4, rejected: 1 });
    // Kalau rata-rata yang dipakai, angka ini akan jadi ~22 ms.
    expect(acousticLatency(pairs([10, 10, 10, 60]))).toEqual({ ms: 10, used: 3, rejected: 1 });
  });

  it('K2 — daftar kosong dan daftar tanpa angka sah menghasilkan null, bukan 0', () => {
    expect(acousticLatency([])).toBeNull();
    expect(acousticLatency(pairs([MIN_LATENCY_MS - 1, MAX_LATENCY_MS + 1, 900]))).toBeNull();
    expect(acousticLatency([{ sentMs: Number.NaN, heardMs: 10 }, { sentMs: 5, heardMs: Number.POSITIVE_INFINITY }])).toBeNull();
  });

  it('latensi nol yang sungguhan tetap dikembalikan sebagai 0', () => {
    expect(acousticLatency(pairs([0]))).toEqual({ ms: 0, used: 1, rejected: 0 });
    expect(acousticLatency(pairs([0, 0, 0]))).toEqual({ ms: 0, used: 3, rejected: 0 });
  });

  it('membulatkan median pecahan dan tidak salah arah', () => {
    expect(acousticLatency(pairs([5, 6]))?.ms).toBe(6); // median 5,5
    expect(acousticLatency(pairs([4, 5]))?.ms).toBe(5); // median 4,5
    // Selisih dihitung heard − sent, bukan sebaliknya: nilai negatif berarti klik "terdengar
    // sebelum diputar" dan itu justru harus ditolak, bukan dibalik jadi angka positif.
    expect(acousticLatency(pairs([-12]))).toBeNull();
  });

  it('menghitung yang dibuang termasuk nilai non-finite dan di luar rentang', () => {
    const data: ClickPair[] = [
      ...pairs([100, 101, 99, 100]),
      { sentMs: 0, heardMs: Number.NaN },
      { sentMs: 0, heardMs: 900 },
      { sentMs: 0, heardMs: -5 },
    ];
    expect(acousticLatency(data)).toEqual({ ms: 100, used: 4, rejected: 3 });
  });

  it('batas ±40 ms inklusif, dan data yang seragam tidak berubah', () => {
    expect(acousticLatency(pairs([100, 100, 100, 100 + MAX_DEV_MS]))?.used).toBe(4);
    expect(acousticLatency(pairs([100, 100, 100, 100 + MAX_DEV_MS + 1]))?.used).toBe(3);
    expect(acousticLatency(pairs([120, 120, 120]))).toEqual({ ms: 120, used: 3, rejected: 0 });
  });
});
