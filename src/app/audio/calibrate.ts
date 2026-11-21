/**
 * M6 — kalibrasi akustik, irisan pertama: aritmetika saja.
 *
 * Yang dihitung di sini adalah selisih antara "klik dijadwalkan" dan "onset terdengar di
 * rekaman mikrofon", lalu diringkas jadi satu angka. Tidak ada mikrofon, speaker, atau DOM di
 * berkas ini — pengukurannya menyusul, dan sampai itu ada, angka apa pun dari sini hanya
 * berlaku untuk data sintetis.
 *
 * Kenapa median dan bukan rata-rata: satu klik yang tertangkap onset palsu (batuk, ketukan
 * meja, gema) menggeser rata-rata beberapa milidetik, sementara median kebal terhadap satu
 * nilai nyasar. Karena itu pembuangannya dua lapis: di luar rentang fisis dulu, lalu di luar
 * ±40 ms dari median.
 */

/** Di bawah 0 tidak mungkin (klik terdengar sebelum diputar); di atas 500 ms bukan lagi HP ini. */
export const MIN_LATENCY_MS = 0;
export const MAX_LATENCY_MS = 500;
/** Satu klik yang menyimpang lebih jauh dari ini dianggap onset palsu, bukan delay perangkat. */
export const MAX_DEV_MS = 40;

export interface ClickPair {
  /** Kapan klik dijadwalkan, di jam audio (ms). */
  sentMs: number;
  /** Kapan onset-nya terdengar di rekaman mikrofon, di jam yang sama (ms). */
  heardMs: number;
}

export interface AcousticEstimate {
  /** Median latensi, dibulatkan ke ms terdekat. */
  ms: number;
  /** Berapa pasangan yang dipakai. */
  used: number;
  /** Berapa pasangan yang dibuang — termasuk nilai non-finite, bukan hanya outlier. */
  rejected: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * `null` berarti "tidak ada angka yang bisa dipercaya", bukan "latensi 0 ms": daftar kosong,
 * semua nilai non-finite, atau semua di luar 0..500. Nol yang sungguhan tetap sah dan
 * dikembalikan sebagai `{ ms: 0 }`.
 */
export function acousticLatency(pairs: readonly ClickPair[]): AcousticEstimate | null {
  const offsets: number[] = [];
  for (const p of pairs) {
    if (!Number.isFinite(p.sentMs) || !Number.isFinite(p.heardMs)) continue;
    const d = p.heardMs - p.sentMs;
    if (d >= MIN_LATENCY_MS && d <= MAX_LATENCY_MS) offsets.push(d);
  }
  if (offsets.length === 0) return null;
  // Median pertama masih memuat outlier; ia hanya dipakai sebagai pusat untuk menyaring.
  const tengah = median(offsets);
  const dekat = offsets.filter((d) => Math.abs(d - tengah) <= MAX_DEV_MS);
  if (dekat.length === 0) return null;
  return { ms: Math.round(median(dekat)), used: dekat.length, rejected: pairs.length - dekat.length };
}
