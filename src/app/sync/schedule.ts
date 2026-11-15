import { beatIndexAt, beatMs, type Grid } from '../../shared/tempo';

/**
 * Jembatan dua jam. `ctx.currentTime` hanya berarti kalau tahu jam dinding berapa ia
 * bernilai segitu, dan pasangan itu harus dibaca berdekatan — itu tugas pemanggil,
 * di sini hanya aritmetika supaya bisa diuji tanpa browser.
 */
export interface ClockBridge {
  /** Date.now() pada saat pasangan diambil. */
  wallMs: number;
  /** ctx.currentTime * 1000 pada saat yang sama. */
  audioMs: number;
  /**
   * Berapa cepat jam audio dibanding jam dinding (1 = sama cepat). Wajib disebut, karena
   * ia TIDAK selalu 1: peramban tanpa DAC sungguhan (headless, tab yang di-throttle) bisa
   * memutar jam audio 2x lebih laju, dan kalau dipaksa 1 seluruh band kehilangan tempo
   * tanpa ada satu pun angka yang kelihatan salah.
   */
  rate: number;
}

export interface PlanInput {
  grid: Grid;
  /** θ = server − lokal (positif = jam dinding tertinggal dari DO). */
  thetaMs: number;
  bridge: ClockBridge;
  /** Perkiraan jeda render→gendang telinga; jadwal dimajukan sejauh ini. */
  latencyCompMs: number;
  /** ctx.currentTime * 1000 sekarang. */
  nowAudioMs: number;
  /** Beat pertama yang belum sempat dijadwalkan; di bawah ini sudah dibunyikan atau dibuang. */
  fromIndex: number;
  horizonMs?: number;
}

export interface BeatJob {
  index: number;
  audioMs: number;
  accent: boolean;
}

export interface Plan {
  jobs: BeatJob[];
  /** fromIndex berikutnya; BeatJob di bawah angka ini tidak akan pernah dibunyikan lagi. */
  nextIndex: number;
  /** Beat yang tidak bisa dijadwalkan karena sudah lewat — click yang benar-benar hilang. */
  missed: number;
}

export const TICK_MS = 25;
// 120 ms = 4x Tick: cukup untuk menutup JavaScript timer yang kesiangan, cukup pendek
// supaya θ yang sudah basi tidak sempat menyetel terlalu banyak beat.
export const LOOKAHEAD_MS = 120;
// Ketukan ke-n dari anchor; 4 = birama umum, dan satu-satunya patokan aksen sampai
// setlist (M3) punya tanda birama sendiri.
export const BEATS_PER_BAR = 4;

export function audioMsOf(bridge: ClockBridge, wallMs: number): number {
  return bridge.audioMs + (wallMs - bridge.wallMs) * bridge.rate;
}

export function wallMsOf(bridge: ClockBridge, audioMs: number): number {
  return bridge.wallMs + (audioMs - bridge.audioMs) / bridge.rate;
}

/**
 * Beat ke-i milik grid jatuh pada waktu server `beatMs(grid, i)`. Waktu itu harus
 * berpindah dua kali sebelum bisa dibunyikan: ke jam dinding HP (−θ), lalu ke jam
 * AudioContext (−latencyComp, karena suara baru sampai comp milidetik SETELAH render).
 * Dua konversi itu adalah seluruh risiko M1b, jadi hidup di sini, bukan di dalam engine.
 */
export function planBeats(input: PlanInput): Plan {
  const { grid, thetaMs, bridge, latencyCompMs } = input;
  // Grid yang tidak masuk akal bukan sekadar jelek: periodMs <= 0 membuat `at` mengecil
  // sementara index naik, sehingga loop di bawah tidak pernah menyentuh horizon dan tab
  // membeku; periodMs Infinity membuat tidak satu pun beat lolos. Keduanya berujung diam.
  if (!Number.isFinite(grid.periodMs) || grid.periodMs <= 0 || !Number.isFinite(grid.anchorMs)) {
    return { jobs: [], nextIndex: input.fromIndex, missed: 0 };
  }
  const shift = thetaMs + latencyCompMs;
  const horizonMs = input.horizonMs ?? LOOKAHEAD_MS;
  const horizon = input.nowAudioMs + horizonMs;
  const audioOf = (index: number) => audioMsOf(bridge, beatMs(grid, index) - shift);

  // Lompat analitik ke beat yang masih mungkin dibunyikan. Tanpa ini, θ yang melompat
  // semenit (NTP client OS mengoreksi jam) membuat loop menyisir ribuan beat dulu.
  const firstNear = beatIndexAt(grid, wallMsOf(bridge, input.nowAudioMs) + shift);
  let index = Math.max(input.fromIndex, firstNear);
  let missed = Math.max(0, index - input.fromIndex);

  const jobs: BeatJob[] = [];
  for (;;) {
    const at = audioOf(index);
    if (at > horizon) break;
    // Web Audio tidak bisa menyetel osc.start() ke masa lalu: beat ini hilang, dan
    // harus terhitung, bukan diam-diam dilewat.
    if (at < input.nowAudioMs) missed++;
    else jobs.push({ index, audioMs: at, accent: index % BEATS_PER_BAR === 0 });
    index++;
  }
  return { jobs, nextIndex: index, missed };
}

/** Beat pertama yang bunyinya masih di depan, untuk layar yang baru bergabung. */
export function firstPlayableIndex(grid: Grid, serverNowMs: number): number {
  return beatIndexAt(grid, serverNowMs) + 1;
}

/**
 * Tempat melanjutkan diri ketika grid berganti di tengah jalan (join, `retune`, reconnect).
 * Cursor lama boleh melompat MAJU, tapi tidak boleh mundur: beat yang sudah sempat disetel
 * oleh grid lama masih ada di antrean oscillator, dan grid baru yang menyetel beat di waktu
 * yang sama menghasilkan klik ganda persis di jahitan tempo.
 *
 * Bayarannya dibayar sadar: frame `state` yang mendarat lebih dari `LOOKAHEAD_MS` terlambat
 * membuat satu beat grid baru jatuh di dalam antrean grid lama, dan beat itu DIBUANG, bukan
 * dibunyikan dua kali. `abandonedBeats` menghitung lubang yang sama dari sisi grid lama —
 * itu yang besar (tab beku), sementara satu beat jahitan di bawah tidak terhitung dan
 * tetap terdengar seperti satu klik yang hilang di telinga, bukan di angka. `shortcut:`
 * patokannya waktu beat terakhir yang disetel, bukan jendela tetap; upgrade saat servo M2
 * sudah tahu persis berapa banyak antrean yang tertinggal.
 */
export function adoptIndex(from: Grid | null, fromIndex: number, to: Grid, serverNowMs: number): number {
  const lastArmed = from !== null && fromIndex > 0 ? beatMs(from, fromIndex - 1) : Number.NEGATIVE_INFINITY;
  return firstPlayableIndex(to, Math.max(serverNowMs, lastArmed));
}

/**
 * Beat milik grid yang sedang playing yang sudah lewat waktu tapi tidak akan pernah
 * disetel lagi — karena `adoptIndex` melompat maju di depan mereka. Tanpa angka ini,
 * tab yang beku sebentar lalu menerima frame `state` melaporkan `0 hilang` padahal
 * seluruh lubang bunyi sudah dibuang di dalam adopsi.
 */
export function abandonedBeats(from: Grid, fromIndex: number, serverNowMs: number): number {
  return Math.max(0, beatIndexAt(from, serverNowMs) - fromIndex + 1);
}
