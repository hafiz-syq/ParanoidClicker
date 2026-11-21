import { median, percentile } from './offset';

/**
 * Satu sampel perjalanan ping. Dua waktu ini adalah titik tengah perjalanan:
 * - `serverMs` = (t2 + t3) / 2, dihitung di jam Durable Object;
 * - `audioMs` = (a1 + a4) / 2, dibaca dari AudioContext.currentTime saat kirim/terima.
 *
 * Titik tengah, bukan t1/t4, supaya asimetri RTT tidak menjadi offset tetap yang
 * menggeser garis drift. RTT tetap disimpan untuk membuang sampel jaringan yang buruk.
 */
export interface DriftSample {
  serverMs: number;
  audioMs: number;
  rttMs: number;
}

export interface DriftFit {
  /** ms jam server per ms jam audio. 1 = tidak ada drift. */
  slope: number;
  /** (slope - 1) × 1e6. Positif = jam audio lebih lambat dari jam server. */
  ppm: number;
  /** (slope - 1) × 60000. Positif = audio tertinggal X ms setiap menit. */
  msPerMinute: number;
  interceptMs: number;
  r2: number;
  /** p95 sisa terhadap garis fit; menunjukkan noise, bukan drift linear. */
  residualP95Ms: number;
}

export interface DriftBin {
  /** Menit ke-1..; nol tidak dipakai supaya tabel langsung bisa dibaca operator. */
  minute: number;
  count: number;
  rttP50Ms: number;
  /** median(server_elapsed - audio_elapsed) terhadap baseline menit pertama; positif = audio tertinggal. */
  cumulativeMs: number | null;
  /** Selisih kumulatif dari bin sebelumnya; null untuk bin pertama yang berisi sampel. */
  deltaMs: number | null;
}

export interface DriftReport {
  n: number;
  used: number;
  rejected: number;
  lost: number;
  durationMs: number;
  rttP50Ms: number;
  rttP95Ms: number;
  fit: DriftFit | null;
  bins: DriftBin[];
  /** Prediksi drift linear sepanjang durasi yang benar-benar terukur. */
  totalDriftMs: number;
}

const MINUTE_MS = 60_000;
const FIT_MIN_SAMPLES = 8;

function medianOrNull(values: number[]): number | null {
  return values.length === 0 ? null : median(values);
}

/**
 * Menghitung drift dari sampel yang sudah lolos validasi timestamp.
 *
 * Sampel diseleksi ke separuh RTT terendah sebelum fit. Yang dicari adalah laju
 * jam, bukan offset jaringan: satu jalur asimetris 300 ms tetap bisa menggeser
 * titik-titik awal/akhir, sementara separuh RTT terendah adalah jalur yang paling
 * dekat dengan perjalanan simetris. Jumlah sampel yang dipakai dilaporkan, bukan
 * disembunyikan.
 */
export function laporanDrift(
  samples: DriftSample[],
  rejected = 0,
  lost = 0
): DriftReport {
  const valid = samples.filter(
    (s) =>
      Number.isFinite(s.serverMs) &&
      Number.isFinite(s.audioMs) &&
      Number.isFinite(s.rttMs) &&
      s.rttMs >= 0
  );
  const base: DriftReport = {
    n: samples.length,
    used: 0,
    rejected,
    lost,
    durationMs: 0,
    rttP50Ms: Number.NaN,
    rttP95Ms: Number.NaN,
    fit: null,
    bins: [],
    totalDriftMs: Number.NaN,
  };
  if (valid.length === 0) return base;

  const rtts = valid.map((s) => s.rttMs);
  const rttP50 = percentile(rtts, 0.5);
  const rttP95 = percentile(rtts, 0.95);
  const low = valid.filter((s) => s.rttMs <= rttP50);
  const used = low.length >= 2 ? low : valid;
  const first = used[0];
  const last = used[used.length - 1];
  const xs = used.map((s) => s.audioMs - first.audioMs);
  const ys = used.map((s) => s.serverMs - first.serverMs);
  const n = used.length;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  let fit: DriftFit | null = null;
  if (n >= FIT_MIN_SAMPLES && varX > 0 && varY > 0) {
    const slope = cov / varX;
    const intercept = meanY - slope * meanX;
    let sse = 0;
    const residuals: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = ys[i] - (intercept + slope * xs[i]);
      residuals.push(r);
      sse += r * r;
    }
    fit = {
      slope,
      ppm: (slope - 1) * 1_000_000,
      msPerMinute: (slope - 1) * MINUTE_MS,
      interceptMs: intercept,
      r2: varY > 0 ? 1 - sse / varY : Number.NaN,
      residualP95Ms: percentile(residuals.map(Math.abs), 0.95),
    };
  }

  const durationMs = last.serverMs - first.serverMs;
  const baseWindow = used.filter((s) => s.serverMs - first.serverMs < MINUTE_MS);
  const baseline = medianOrNull(
    (baseWindow.length > 0 ? baseWindow : [first]).map(
      (s) => s.serverMs - first.serverMs - (s.audioMs - first.audioMs)
    )
  );

  const groups = new Map<number, DriftSample[]>();
  for (const s of used) {
    // Bin memakai jam audio, bukan jam server: jendela 20 menit dijadwalkan dari sisi
    // audio, dan memakai jam server yang sedikit lebih cepat bisa menciptakan bin ke-21
    // hanya karena drift 120 ms di ujung jendela.
    const minute = Math.floor((s.audioMs - first.audioMs) / MINUTE_MS) + 1;
    const group = groups.get(minute);
    if (group) group.push(s);
    else groups.set(minute, [s]);
  }

  const bins: DriftBin[] = [];
  let previous: number | null = null;
  const lastMinute = Math.max(1, Math.ceil((last.audioMs - first.audioMs) / MINUTE_MS));
  for (let minute = 1; minute <= lastMinute; minute++) {
    const group = groups.get(minute) ?? [];
    if (group.length === 0) {
      bins.push({
        minute,
        count: 0,
        rttP50Ms: Number.NaN,
        cumulativeMs: null,
        deltaMs: null,
      });
      continue;
    }
    const cumulative = median(
      group.map((s) => s.serverMs - first.serverMs - (s.audioMs - first.audioMs))
    ) - (baseline ?? 0);
    bins.push({
      minute,
      count: group.length,
      rttP50Ms: percentile(group.map((s) => s.rttMs), 0.5),
      cumulativeMs: cumulative,
      deltaMs: previous === null ? null : cumulative - previous,
    });
    previous = cumulative;
  }

  return {
    ...base,
    used: n,
    durationMs,
    rttP50Ms: rttP50,
    rttP95Ms: rttP95,
    fit,
    bins,
    totalDriftMs: fit ? fit.msPerMinute * (durationMs / MINUTE_MS) : Number.NaN,
  };
}
