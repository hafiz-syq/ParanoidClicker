export interface Stamps {
  t1: number;
  t2: number;
  t3: number;
  t4: number;
}

export interface Sample {
  rttMs: number;
  delayMs: number;
  offsetMs: number;
}

// null = sampel tidak bisa dipercaya. Tiga sebab yang benar-benar terjadi di lapangan:
// (1) RTT 0/negatif karena resolusi Date.now() cuma 1 ms dan perjalanannya muat dalam satu
// milidetik — paling sering di localhost; (2) jam dinding HP melompat mundur di antara dua cap
// (NTP client OS, ganti timezone); (3) lawan mengirim t1 absurd. Ketiganya wajib dibuang lebih
// dulu karena delay negatif selalu menang di sort estimasiOffset, dan θ hasil akhirnya tetap
// terbaca wajar sementara jitter-nya 0 — angka palsu yang lolos sensor.
export function toSample(s: Stamps): Sample | null {
  if (!Number.isFinite(s.t1) || !Number.isFinite(s.t2) || !Number.isFinite(s.t3) || !Number.isFinite(s.t4))
    return null;
  const rttMs = s.t4 - s.t1 - (s.t3 - s.t2);
  if (rttMs <= 0) return null;
  return {
    rttMs,
    delayMs: rttMs / 2,
    offsetMs: ((s.t2 - s.t1) + (s.t3 - s.t4)) / 2,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

export interface Dist {
  p50: number;
  p95: number;
  max: number;
}

export function dist(values: number[]): Dist {
  return { p50: median(values), p95: percentile(values, 0.95), max: percentile(values, 1) };
}

// Estimasi offset terbaik = median dari k sampel ber-delay paling kecil.
// Rata-rata atau median atas SEMUA sampel salah di sini: spike asimetris 300 ms
// menyeret estimasi, padahal spike itu justru yang harus dibuang.
export function estimateOffset(samples: Sample[], k = 4): number {
  if (samples.length === 0) return NaN;
  const best = [...samples].sort((a, b) => a.delayMs - b.delayMs).slice(0, k);
  return median(best.map((s) => s.offsetMs));
}

// Jitter yang kita janjikan adalah ketidakstabilan ESTIMASI offset antar window,
// bukan RTT mentah: yang bocor ke fase adalah offset, dan RTT simetris tidak bergerak.
export function estimateJitter(samples: Sample[], window = 8, k = 4): number {
  if (samples.length < window * 2) return NaN;
  const estimates: number[] = [];
  for (let end = window; end <= samples.length; end++) {
    estimates.push(estimateOffset(samples.slice(end - window, end), k));
  }
  const deltas: number[] = [];
  for (let i = 1; i < estimates.length; i++) deltas.push(Math.abs(estimates[i] - estimates[i - 1]));
  return percentile(deltas, 0.95);
}
