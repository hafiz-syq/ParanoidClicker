import { describe, expect, it } from 'vitest';
import { LEAD_MS, beatIndexAt, beatMs, gridOf, periodOf, retune, type Grid } from '../../shared/tempo';
import {
  BEATS_PER_BAR,
  LOOKAHEAD_MS,
  abandonedBeats,
  adoptIndex,
  firstPlayableIndex,
  planBeats,
  wallMsOf,
  type ClockBridge,
  type PlanInput,
} from './schedule';

// Jam server sengaja 657 ms di depan jam dinding — θ yang benar-benar diukur dari HP
// pertama di lapangan (13 Nov 2026), supaya ujiannya memakai angka nyata, bukan angka rapi.
const THETA = 657;
const BRIDGE: ClockBridge = { wallMs: 1_700_000_000_000, audioMs: 4_250, rate: 1 };
const anchor = BRIDGE.wallMs + THETA + 300;
const G120: Grid = gridOf(120, anchor);
// Beat 0 terdengar 300 ms sesudah "sekarang" bridge di atas (LEAD_MS).
const FIRST_AUDIO = BRIDGE.audioMs + 300;

function plan(over: Partial<PlanInput> = {}) {
  return planBeats({
    grid: G120,
    thetaMs: THETA,
    bridge: BRIDGE,
    latencyCompMs: 0,
    nowAudioMs: BRIDGE.audioMs,
    fromIndex: firstPlayableIndex(G120, BRIDGE.wallMs + THETA),
    horizonMs: 120,
    ...over,
  });
}

describe('planBeats', () => {
  it('θ memindahkan beat ke jam dinding, comp memajukan render, tanda θ tidak boleh tertukar', () => {
    const b: ClockBridge = { wallMs: 0, audioMs: 0, rate: 1 };
    const g = gridOf(120, THETA + 40);
    const at = (theta: number, comp: number) =>
      planBeats({
        grid: g,
        thetaMs: theta,
        bridge: b,
        latencyCompMs: comp,
        nowAudioMs: 0,
        fromIndex: 0,
        horizonMs: 2_000,
      });
    expect(at(THETA, 0).jobs.map((j) => j.index)).toEqual([0, 1, 2, 3]);
    expect(at(THETA, 0).jobs[0]?.audioMs).toBe(40);
    expect(at(THETA, 40).jobs[0]?.audioMs).toBe(0);
    // Salah tanda θ = seluruh band meleset 1,3 detik, dan tidak ada tes lain yang menangkapnya.
    expect(at(-THETA, 0).jobs[0]?.audioMs).toBe(40 + 2 * THETA);
  });

  it('audio clock yang berdetak 2,5× lebih cepat tidak mengubah jarak klik di jam dinding', () => {
    // Terukur di Chromium headless: ctx.currentTime maju 2,3× jam dinding. Kalau rate
    // diabaikan, scheduler menyangka horizon masih panjang dan membunyikan 65 klik
    // dalam 11 detik pada 120 bpm.
    const b: ClockBridge = { wallMs: 0, audioMs: 0, rate: 2.5 };
    const g = gridOf(120, 100);
    const p = planBeats({
      grid: g,
      thetaMs: 0,
      bridge: b,
      latencyCompMs: 0,
      nowAudioMs: 0,
      fromIndex: 0,
      horizonMs: 3_000,
    });
    expect(p.jobs.map((j) => j.audioMs)).toEqual([250, 1_500, 2_750]);
    // Dibalik ke jam dinding, jaraknya tetap satu periode — angka itu yang dipakai probe drift.
    expect(p.jobs.map((j) => wallMsOf(b, j.audioMs) - 100)).toEqual([0, 500, 1_000]);
  });

  it('jendela 120 ms pada 120 bpm tidak pernah memuat dua beat', () => {
    for (let d = 0; d < periodOf(120); d += 37) {
      const g = gridOf(120, BRIDGE.wallMs + THETA + d);
      const p = planBeats({
        grid: g,
        thetaMs: THETA,
        bridge: BRIDGE,
        latencyCompMs: 0,
        nowAudioMs: BRIDGE.audioMs,
        fromIndex: 0,
        horizonMs: 120,
      });
      expect(p.jobs.length).toBeLessThanOrEqual(1);
    }
  });

  it('beat yang sudah lewat tidak dijadwalkan dan terhitung sebagai klik hilang', () => {
    // now maju setengah periode: beat 0 tidak bisa lagi dibunyikan, beat 1 belum masuk jendela.
    const p = plan({ nowAudioMs: FIRST_AUDIO + periodOf(120) / 2 });
    expect(p.jobs).toEqual([]);
    expect(p.missed).toBe(1);
    expect(p.nextIndex).toBe(1);
  });

  it('cursor melanjutkan dari beat yang belum disetel, tanpa menghitung ulang yang lama', () => {
    const p = plan({ fromIndex: 1, horizonMs: 2_000 });
    expect(p.jobs.map((j) => j.index)).toEqual([1, 2, 3]);
    expect(p.nextIndex).toBe(4);
    expect(p.missed).toBe(0);
  });

  it('aksen jatuh tiap BEATS_PER_BAR sejak anchor', () => {
    const p = plan({ horizonMs: 5 * periodOf(120) });
    expect(p.jobs.map((j) => j.accent)).toEqual([true, false, false, false, true]);
    expect(BEATS_PER_BAR).toBe(4);
  });

  it('lompatan jam 60 detik dihitung sebagai 120 klik hilang, bukan loop tanpa akhir', () => {
    // 120 bpm x 60 detik = 120 beat yang ditelan lompatan jam; angka itu harus muncul di layar.
    const p = plan({ thetaMs: THETA + 60_000 });
    expect(p.jobs).toEqual([]);
    expect(p.missed).toBe(120);
    expect(p.nextIndex).toBe(120);
  });

  it('beat jahitan hanya berbunyi sekali saat tempo berubah di tengah jalan', () => {
    const b: ClockBridge = { wallMs: 0, audioMs: 0, rate: 1 };
    const lama = gridOf(120, 0);
    const batas = beatMs(lama, 3);
    const baru = retune(lama, 90, batas);
    expect(baru.anchorMs).toBe(batas);
    const sebelum = planBeats({
      grid: lama,
      thetaMs: 0,
      bridge: b,
      latencyCompMs: 0,
      nowAudioMs: 0,
      fromIndex: 1,
      horizonMs: 1_500,
    });
    // Layar yang mengadopsi grid baru mulai dari beat SESUDAH batas, karena beat batas
    // sudah pernah disetel oleh grid lama.
    const sesudah = planBeats({
      grid: baru,
      thetaMs: 0,
      bridge: b,
      latencyCompMs: 0,
      nowAudioMs: batas,
      fromIndex: firstPlayableIndex(baru, batas),
      horizonMs: 2_000,
    });
    const jahitan = [...sebelum.jobs, ...sesudah.jobs].filter((j) => Math.abs(j.audioMs - batas) < 1);
    expect(jahitan.length).toBe(1);
    expect(sesudah.jobs[0]?.audioMs).toBeCloseTo(batas + periodOf(90), 6);
  });

  it('grid yang tidak masuk akal membuat scheduler diam, bukan membekukan tab', () => {
    // Empat bentuk ini adalah yang bisa dihasilkan angka jahat dari jaringan: `bpm: 0`
    // memberi periodMs Infinity (tidak ada beat yang lolos, klik bisu tanpa error), dan
    // periode 0/negatif membuat `at` menurun selagi index naik — loop tanpa akhir.
    const b: ClockBridge = { wallMs: 0, audioMs: 0, rate: 1 };
    const jahat: Grid[] = [
      { anchorMs: 0, periodMs: Number.POSITIVE_INFINITY },
      { anchorMs: 0, periodMs: 0 },
      { anchorMs: 0, periodMs: -500 },
      { anchorMs: 0, periodMs: Number.NaN },
      { anchorMs: Number.NaN, periodMs: 500 },
    ];
    for (const g of jahat) {
      expect(planBeats({ grid: g, thetaMs: 0, bridge: b, latencyCompMs: 0, nowAudioMs: 0, fromIndex: 7, horizonMs: 120 })).toEqual(
        { jobs: [], nextIndex: 7, missed: 0 }
      );
    }
  });
});

describe('firstPlayableIndex', () => {
  it('layar yang datang sebelum beat pertama mulai dari beat 0', () => {
    expect(firstPlayableIndex(G120, BRIDGE.wallMs + THETA)).toBe(0);
  });

  it('layar yang bergabung di tengah lagu menunjuk beat berikutnya, bukan yang sudah lewat', () => {
    expect(firstPlayableIndex(G120, anchor + 10 * periodOf(120) + 10)).toBe(11);
  });
});

describe('adoptIndex', () => {
  const lama = gridOf(120, 0);
  const jahitan = beatMs(lama, 6);
  const baru = retune(lama, 90, jahitan);
  // serverNow sengaja 500 ms SEBELUM jahitan: frame `state` boleh mendarat sebelum waktunya.
  const serverNow = jahitan - 500;

  it('tepat waktu: beat pertama grid baru adalah jahitan itu sendiri', () => {
    // Cursor 6 = beat 0..5 grid lama sudah disetel; beat 6 (3000 ms) belum.
    expect(adoptIndex(lama, 6, baru, serverNow).index).toBe(0);
    expect(beatMs(baru, 0)).toBe(jahitan);
  });

  it('terlambat: satu beat grid baru dibuang, bukan dibunyikan dua kali', () => {
    expect(firstPlayableIndex(baru, serverNow)).toBe(0);
    // Cursor 7 berarti grid lama sudah menyetel oscillator pada 3000 ms. Grid baru yang
    // ikut mulai di 3000 ms menghasilkan klik ganda persis di jahitan — harga yang dibayar
    // di sini adalah beat 0 milik grid baru, bukan bunyi ganda.
    expect(adoptIndex(lama, 7, baru, serverNow).index).toBe(1);
    expect(beatMs(baru, 1)).toBeCloseTo(jahitan + periodOf(90), 6);
    // Tanpa beat yang sudah disetel (cursor 0), tidak ada yang boleh dibuang.
    expect(adoptIndex(lama, 0, baru, serverNow).index).toBe(0);
  });

  it('layar yang belum pernah menyetel apa pun ikut jam server', () => {
    expect(adoptIndex(null, 0, G120, anchor + 2 * periodOf(120) + 5).index).toBe(3);
    expect(adoptIndex(null, 0, G120, BRIDGE.wallMs + THETA).index).toBe(0);
  });

  it('beat yang tertelan di bawah patokan dilaporkan sebagai angka, bukan hilang diam-diam', () => {
    // Utang yang dibayar (ADR-0003): frame `state` yang mendarat terlambat membuat beat grid
    // baru jatuh di dalam sisa antrean grid lama dan beat itu DIBUANG. Sebelumnya hanya
    // komentarnya yang tahu; `abandonedBeats` mengukur dari serverNow dan melaporkan 0.
    const lama = gridOf(120, 0);
    // Beat 0..5 (2500 ms) sudah disetel, jam server 2400 ms → antrean masih memegang 2500 ms.
    const serverNow = 2_400;
    const cursor = 6;
    const baru = gridOf(90, 2_450); // beat 0-nya 2450 ms: di dalam jendela antrean, bukan di jahitan
    const a = adoptIndex(lama, cursor, baru, serverNow);
    expect(firstPlayableIndex(baru, serverNow)).toBe(0);
    expect(a.index).toBe(1);
    expect(a.swallowed).toBe(1);
    // Yang dijahit retune bukan lubang: beat 2450 tetap berbunyi dari antrean grid lama di
    // waktu yang sama persis, jadi yang tertelan nol.
    const jahitan = adoptIndex(lama, cursor, retune(lama, 90, 2_500), serverNow);
    expect(jahitan.swallowed).toBe(0);
  });

  it('jahitan tempo dengan lead server tidak pernah menelan beat, untuk tempo apa pun', () => {
    // Ini identitas yang membuat ramp (ADR-0002) aman: LEAD_MS 300 > LOOKAHEAD_MS 120, jadi
    // beat pertama grid baru selalu jatuh sesudah ekor antrean grid lama.
    const lama = gridOf(120, 0);
    for (let t = 0; t < 4 * periodOf(120); t += 17) {
      // Cursor = beat pertama yang belum sempat disetel pada jam server t.
      const cursor = beatIndexAt(lama, t + LOOKAHEAD_MS) + 1;
      for (const bpm of [30, 60, 90, 120, 180, 240, 300]) {
        const baru = retune(lama, bpm, t + LEAD_MS);
        expect(adoptIndex(lama, cursor, baru, t).swallowed).toBe(0);
      }
    }
  });
});

describe('abandonedBeats', () => {
  const lama = gridOf(120, 0);

  it('cursor yang wajar di depan jam tidak membuang apa pun', () => {
    // Beat 0..5 sudah disetel (cursor 6) dan yang paling baru itu jatuh 400 ms lagi.
    expect(abandonedBeats(lama, 6, 2500)).toBe(0);
    expect(abandonedBeats(lama, 6, 2_999)).toBe(0);
  });

  it('setiap beat yang sudah lewat dan tidak disetel dihitung sebagai klik hilang', () => {
    // Beat 3000 ms baru saja lewat dan cursor masih di 6: satu klik bolong.
    expect(abandonedBeats(lama, 6, 3_001)).toBe(1);
    // Tab beku 2,6 detik pada 120 bpm = 6 beat yang tidak akan pernah berbunyi lagi.
    expect(abandonedBeats(lama, 6, 5_600)).toBe(6);
  });

  it('jahitan yang dilewati antrean grid lama bukan klik hilang', () => {
    const baru = retune(lama, 90, 3_000);
    // adoptIndex membuang beat 0 grid baru (3000 ms), tapi beat itu SUDAH ada di antrean
    // oscillator grid lama — jadi yang hilang tetap nol, bukan satu.
    expect(adoptIndex(lama, 7, baru, 2_500).index).toBe(1);
    expect(abandonedBeats(lama, 7, 2_500)).toBe(0);
  });
});
