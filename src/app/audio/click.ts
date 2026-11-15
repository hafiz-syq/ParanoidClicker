import type { Grid } from '../../shared/tempo';
import { dist } from '../sync/offset';
import {
  LOOKAHEAD_MS,
  TICK_MS,
  abandonedBeats,
  adoptIndex,
  planBeats,
  startsLater,
  wallMsOf,
  type BeatJob,
  type ClockBridge,
} from '../sync/schedule';
import { servoAdvance, servoIdle, servoSetTarget, type Servo } from '../sync/servo';

const ACCENT_HZ = 1760;
const CLICK_HZ = 1175;
const CLICK_S = 0.05;
// Durasi sebuah klik termasuk jeda setelahnya; dipakai untuk menghitung kapan onended
// seharusnya datang, dan itu juga batas atas seberapa lama satu klik boleh dianggap meleset.
const CLICK_TOTAL_MS = (CLICK_S + 0.01) * 1000;
// Dasar pengukuran laju jam audio: satu detik cukup untuk resolusi jam 1 ms (±0,1%) dan
// cukup pendek untuk memperbaiki tab yang di-throttle dalam hitungan detik, bukan menit.
const RATE_WINDOW_MS = 1_000;
// Batasannya keputusan sadar: cukup lebar untuk peramban tanpa DAC sungguhan (terukur 2,3x
// di Chromium headless), cukup sempit supaya satu lonjakan ctx.currentTime tidak bisa
// membuat klik melambat seratus kali tanpa terlihat.
const RATE_MIN = 0.25;
const RATE_MAX = 4;

export interface ClickStats {
  played: number;
  missed: number;
  /** 'running' = sehat. 'suspended' = layar mati/tab latar: jam audio membeku, klik hilang. */
  ctxState: string;
  /** 1,00 = jam audio berdetak sama cepat dengan jam dinding. Bukan selalu benar. */
  audioRate: number;
  /** true = jam audio tidak maju sama sekali selama ≥1 jendela ukur: tab di-throttle / layar tidur. */
  audioStalled: boolean;
  /** Selisih (ms) antara waktu render yang diminta dan waktu blok terakhir ctx. */
  latencyCompMs: number;
  /** θ yang SEKARANG dipakai klik — bisa tertinggal dari hasil ukur, karena servo bertingkat. */
  thetaMs: number;
  /** Berapa kali θ ditutup sekali lompat (≥ setengah periode): jalur pemulihan, bukan jitter. */
  thetaJumps: number;
  /** Beat grid baru yang dibuang di jahitan karena antrean grid lama sudah memegangnya. */
  swallowed: number;
  /** Berapa milidetik bunyi datang terlambat dari yang diminta — diukur di dalam browser. */
  driftP50Ms: number;
  driftP95Ms: number;
  driftMaxMs: number;
  driftSamples: number;
}

export interface ClickEngineOptions {
  onStats?: (s: ClickStats) => void;
}

type AudioCtor = new () => AudioContext;

function contextCtor(): AudioCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Membunyikan grid DO lewat Web Audio. Yang disimpan engine hanya satu angka: indeks beat
 * berikutnya yang belum disetel. Semuanya turunan — jam (bridge), θ, dan kompensasi latency
 * boleh berubah kapan saja tanpa ada keadaan yang bisa saling bertentangan.
 *
 * θ masuk lewat servo 4 tingkat (ADR-0001): satu tingkat per TICK_MS, jadi satu koreksi
 * selesai dalam 100 ms — lebih cepat dari satu pong. Jalur wewenangnya NUDGE_ONLY: servo
 * tidak pernah menulis `anchorMs` dan tidak pernah mengirim frame apa pun.
 */
export class ClickEngine {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private live = new Set<OscillatorNode>();
  private grid: Grid | null = null;
  /**
   * Grid dari frame `state` yang `anchorMs`-nya masih di depan. Dibunyikannya baru mulai
   * pada anchor itu (ADR-0004); sampai saat itu grid lama tetap yang dipakai menyetel beat,
   * karena beat grid lama di antara ekor antrean dan anchor adalah klik yang benar-benar
   * akan dibunyikan dan tidak boleh dibuang oleh frame yang datang lebih awal.
   */
  private pending: Grid | null = null;
  private nextIndex = 0;
  private servo: Servo = servoIdle(0);
  private compMs = 0;
  private rate = 1;
  private rateRef: ClockBridge | null = null;
  /** true sesudah destroy(): tidak boleh ada timer yang lahir lagi dari engine mati. */
  private dead = false;
  private stalled = false;
  private played = 0;
  private missed = 0;
  private swallowed = 0;
  private thetaJumps = 0;
  private drifts: number[] = [];
  private lastKey = '';

  constructor(private readonly opts: ClickEngineOptions = {}) {}

  /**
   * HARUS dipanggil dari dalam gesture pengguna (tap tombol): browser mobile menolak
   * AudioContext yang dibuat diam-diam, dan kliknya bisu tanpa satu pun error.
   */
  async unlock(): Promise<string> {
    if (!this.ctx) {
      const Ctor = contextCtor();
      if (!Ctor) throw new Error('AudioContext tidak ada di browser ini');
      this.ctx = new Ctor();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const c = this.ctx as AudioContext & { outputLatency?: number };
    // Kompensasi default: renderctx → DAC → udara. outputLatency tidak ada di semua
    // browser, dan sama sekali tidak memasukkan delay Bluetooth TWS (M6 mengukurnya akustik).
    this.compMs = (c.baseLatency + (c.outputLatency ?? 0)) * 1000;
    return `${this.ctx.state} sr=${this.ctx.sampleRate} base=${(c.baseLatency * 1000).toFixed(1)}ms ` +
      `output=${c.outputLatency === undefined ? '?' : (c.outputLatency * 1000).toFixed(1)}ms comp=${this.compMs.toFixed(1)}ms`;
  }

  /** Ganti grid dari frame `state`; null = berhenti membunyikan, konteks tetap hidup. */
  setGrid(grid: Grid | null): void {
    if (!grid) {
      this.stop();
      return;
    }
    if (this.grid && startsLater(grid, this.serverNowMs())) {
      this.pending = grid;
      return;
    }
    this.pending = null;
    this.adopt(grid);
  }

  /**
   * Serah terima yang sebenarnya: cursor lama boleh melompat MAJU, tapi tidak boleh mundur,
   * karena beat yang sudah sempat disetel masih ada di antrean oscillator.
   */
  private adopt(grid: Grid): Grid {
    const serverNow = this.serverNowMs();
    // Lompatan maju itu sendiri membuang klik, dan harus terhitung: frame `state` yang
    // mendarat sesudah tab beku adalah cara paling sering jalur ini dilewati.
    if (this.grid) this.missed += abandonedBeats(this.grid, this.nextIndex, serverNow);
    const adopt = adoptIndex(this.grid, this.nextIndex, grid, serverNow);
    // Beat yang tertelan di jahitan bukan klik hilang: ia sudah berbunyi dari antrean grid
    // lama. Digabung ke `missed` akan mengajari operator mengabaikan angka `0 hilang`.
    this.swallowed += adopt.swallowed;
    this.nextIndex = adopt.index;
    this.grid = grid;
    this.startTimer();
    return grid;
  }

  setTheta(thetaMs: number): void {
    // Belum ada satu beat pun yang disetel → tidak ada yang bisa dobel atau ditumpuk, jadi
    // θ dipakai seketika. Ini jalur 657 ms HP pertama (ADR-0001), bukan servo yang bocor.
    if (this.nextIndex === 0) {
      if (Number.isFinite(thetaMs)) this.servo = servoIdle(thetaMs);
      this.report();
      return;
    }
    const r = servoSetTarget(this.servo, thetaMs, this.grid?.periodMs ?? Number.POSITIVE_INFINITY);
    if (r.jumped) this.thetaJumps++;
    this.servo = r.servo;
    this.report();
  }

  setLatencyComp(ms: number): void {
    this.compMs = Number.isFinite(ms) ? ms : 0;
    this.report();
  }

  latencyCompMs(): number {
    return this.compMs;
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.grid = null;
    // Frame `state` yang sudah di jalan tidak boleh menyelinap jadi klik setelah Stop.
    this.pending = null;
    this.silence();
    this.report();
  }

  destroy(): void {
    this.dead = true;
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    // Context yang sudah ditutup menolak `close()`; tanpa catch ini penghancuran kedua
    // menghasilkan unhandled rejection di layar yang sedang tidak menampilkan apa pun.
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private serverNowMs(): number {
    return Date.now() + this.servo.appliedMs;
  }

  private silence(): void {
    // Beat yang sudah disetel tapi belum berbunyi (jendela lookahead) harus ikut mati,
    // kalau tidak tombol Stop masih melahirkan satu klik terakhir.
    const at = this.ctx ? this.ctx.currentTime : 0;
    for (const osc of this.live) {
      try {
        osc.stop(at);
      } catch {
        // sudah berhenti sendiri — tidak ada yang perlu dilakukan
      }
    }
    this.live.clear();
  }

  private startTimer(): void {
    if (this.dead || this.timer !== null) return;
    // Sampel laju dari sebelum Stop tidak berlaku lagi sesudahnya.
    this.rateRef = null;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /**
   * Jam audio tidak selalu berdetak secepat jam dinding: di peramban tanpa DAC ia bisa
   * melaju 2x, dan saat layar tidur ia membeku sama sekali. Karena itu grid dibaca lewat
   * laju yang diukur, bukan lewat asumsi 1,00.
   */
  private bridge(wallMs: number, audioMs: number, state: string): ClockBridge {
    const ref = this.rateRef;
    if (!ref) {
      this.rateRef = { wallMs, audioMs, rate: this.rate };
      this.stalled = false;
    } else if (state === 'running' && wallMs - ref.wallMs >= RATE_WINDOW_MS) {
      const wall = wallMs - ref.wallMs;
      const audio = audioMs - ref.audioMs;
      // Jam audio yang tidak maju sama sekali (tab di-throttle, layar tidur) bukan laju
      // 0,25: itu berhenti. Rate lama lebih jujur daripada clamp bawah, dan referensinya
      // sengaja tidak dipindah supaya pengukuran berikutnya mencakup seluruh pembekuan.
      this.stalled = audio <= 0;
      if (!this.stalled) {
        this.rate = Math.min(RATE_MAX, Math.max(RATE_MIN, audio / wall));
        this.rateRef = { wallMs, audioMs, rate: this.rate };
      }
    }
    return { wallMs, audioMs, rate: this.rate };
  }

  private tick(): void {
    const ctx = this.ctx;
    let grid = this.grid;
    if (!ctx || !grid) return;
    // Satu tingkat per tick, di depan segalanya: θ tidak boleh menunggu jam audio sehat,
    // karena tab yang beku pun terus diberi pong.
    this.servo = servoAdvance(this.servo);
    if (ctx.state !== 'running') {
      // Konteks beku: jam audio berhenti sementara jam dinding jalan terus. Menyetel beat
      // sekarang sama saja mengumpulkan satu ledakan klik untuk dibunyikan sekaligus saat
      // konteks hidup lagi. Beat yang lewat di bawah sini baru dihitung hilang setelah
      // jam audio jalan lagi dan planBeats menyusul selisihnya.
      this.report();
      return;
    }
    // Jam server sudah menyentuh anchor grid baru → saatnya serah terima. Sebelum titik ini
    // grid lama yang berhak menyetel beat, dan sesudahnya grid baru; tidak ada satu pun beat
    // yang hilang di antaranya.
    if (this.pending && !startsLater(this.pending, this.serverNowMs())) {
      const next = this.pending;
      this.pending = null;
      grid = this.adopt(next);
    }
    // Dibaca berdekatan: kesalahan kopling dua jam ini paling besar beberapa perempat
    // milidetik, dan diulang setiap TICK_MS sehingga tidak pernah menumpuk jadi drift.
    const wallMs = Date.now();
    const nowAudioMs = ctx.currentTime * 1000;
    const bridge = this.bridge(wallMs, nowAudioMs, ctx.state);
    const plan = planBeats({
      grid,
      thetaMs: this.servo.appliedMs,
      bridge,
      latencyCompMs: this.compMs,
      nowAudioMs,
      fromIndex: this.nextIndex,
      horizonMs: LOOKAHEAD_MS,
    });
    this.nextIndex = plan.nextIndex;
    this.missed += plan.missed;
    for (const job of plan.jobs) {
      this.fire(ctx, job, bridge);
    }
    this.report();
  }

  /**
   * `bridge` menerjemahkan jam audio ↔ jam dinding pada tick ini, termasuk laju jam audio
   * yang sebenarnya; tanpa itu satu klik yang diminta pada 4550 ms bisa mendarat di mana saja.
   */
  private fire(ctx: AudioContext, job: BeatJob, bridge: ClockBridge): void {
    const t = job.audioMs / 1000;
    // CLICK_TOTAL_MS hidup di jam audio, jadi ia ikut dibagi laju sebelum dipindah ke
    // jam dinding — ditambah telanjang, probe-nya meleset CLICK_TOTAL·(1−1/rate) ≈ 34 ms
    // persis di kondisi yang membuat `rate` ada.
    const seharusnyaSelesaiMs = wallMsOf(bridge, job.audioMs + CLICK_TOTAL_MS);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = job.accent ? ACCENT_HZ : CLICK_HZ;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(job.accent ? 1 : 0.55, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + CLICK_S);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => {
      this.live.delete(osc);
      osc.disconnect();
      gain.disconnect();
      // Positif = bunyi datang terlambat. Ini angka yang dilihat operator kalau ada yang
      // bilang "kliknya beda sendiri", bukan perkiraan dari rumus.
      this.drift(Date.now() - seharusnyaSelesaiMs);
      this.report();
    };
    osc.start(t);
    osc.stop(t + CLICK_S + 0.01);
    this.live.add(osc);
    this.played++;
  }

  private drift(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.drifts.push(ms);
    // 240 beat terakhir = sekitar dua menit pada 120 bpm: cukup untuk p95 yang stabil,
    // cukup pendek supaya satu lonjakan lama tidak ikut membilas keadaan sekarang.
    if (this.drifts.length > 240) this.drifts.splice(0, this.drifts.length - 240);
  }

  private report(): void {
    const d = dist(this.drifts);
    const s: ClickStats = {
      played: this.played,
      missed: this.missed,
      ctxState: this.ctx?.state ?? 'belum dibuat',
      audioRate: this.rate,
      audioStalled: this.stalled,
      latencyCompMs: this.compMs,
      thetaMs: this.servo.appliedMs,
      thetaJumps: this.thetaJumps,
      swallowed: this.swallowed,
      driftP50Ms: d.p50,
      driftP95Ms: d.p95,
      driftMaxMs: d.max,
      driftSamples: this.drifts.length,
    };
    // Semua angka yang dibaca panel diagnostik ikut dibandingkan: 40 tick per detik tanpa
    // perubahan tidak perlu membangunkan React, tapi kompensasi yang baru diketik operator
    // harus muncul detik itu juga, bukan pada klik berikutnya.
    const key =
      `${s.played}|${s.missed}|${s.swallowed}|${s.thetaJumps}|${s.thetaMs.toFixed(3)}|` +
      `${s.ctxState}|${s.driftSamples}|${s.audioRate}|${s.audioStalled}|${s.latencyCompMs}`;
    if (this.lastKey === key) return;
    this.lastKey = key;
    this.opts.onStats?.(s);
  }
}
