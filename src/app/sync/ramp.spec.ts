import { describe, expect, it } from 'vitest';
import {
  LEAD_MS,
  MAX_BPM,
  MIN_BPM,
  beatIndexAt,
  beatMs,
  gridOf,
  nextBeatMs,
  parseBpm,
  periodOf,
  retune,
  type Grid,
} from '../../shared/tempo';
import { LOOKAHEAD_MS, TICK_MS, adoptIndex, firstPlayableIndex, planBeats, startsLater, type ClockBridge } from './schedule';
import { RAMP_STEP_BPM, barSeamMs, rampBpm, rampStart, rampStep } from './ramp';

const P120 = periodOf(120);

/** Server lama: satu-satunya jalan tempo berubah adalah pemimpin mengirim `tempo`, DO menghitung
 *  `retune(grid, bpm, Date.now() + LEAD_MS)` (SessionDO.ts:171) lalu menyiarkan `state`. */
function serverSetTempo(grid: Grid, bpm: number, serverNowMs: number): Grid {
  return retune(grid, bpm, serverNowMs + LEAD_MS);
}

describe('barSeamMs: kapan sebuah jahitan masih jatuh di awal bar', () => {
  it('menolak jahitan yang jatuh di tengah bar', () => {
    const g = gridOf(120, 0);
    // at = 750 → beat berikutnya 1000 ms = indeks 2 = tengah bar, dan masih ada 250 ms sebelum
    // jahitan (lolos batas dekat). Yang menolaknya di sini HANYA predikat awal bar.
    expect(barSeamMs(g, 750 - LEAD_MS)).toBeNull();
    // at = 1750 → beat berikutnya 2000 ms = indeks 4 = awal bar → boleh diinjak.
    expect(barSeamMs(g, 1750 - LEAD_MS)).toBe(2_000);
  });

  it('menolak jahitan yang sudah terlalu dekat dan menerima seluruh sisa beat', () => {
    // Batas dekat adalah harga yang benar-benar dibayar: frame yang dikirim 1 ms sebelum
    // jahitan pasti mendarat sesudahnya (p95 RTT lapangan 99 ms), dan server lalu mengambil
    // beat BERIKUTNYA — yang di tengah bar. Aksen pindah dan tidak ada angka yang menunjukkannya.
    const g = gridOf(120, 0);
    for (const d of [1, 100]) {
      expect(barSeamMs(g, P120 * 4 - LEAD_MS - d)).toBeNull();
    }
    // Seperempat periode tepat di depan jahitan: itu batasnya, bukan selera.
    expect(barSeamMs(g, P120 * 4 - LEAD_MS - P120 / 4)).toBe(P120 * 4);
    // Tidak ada batas jauh: semakin awal di dalam beat terakhir, semakin banyak sisa waktu
    // buat frame yang terlambat, dan langkahnya tetap mendarat di bar yang sama.
    for (const d of [P120 / 4 + 1, P120 - 100, P120 - 1]) {
      expect(barSeamMs(g, P120 * 4 - LEAD_MS - d)).toBe(P120 * 4);
    }
  });

  it('selalu menunjuk beat yang akan dipakai server, bukan beat berikutnya lagi', () => {
    const g = gridOf(120, 300);
    for (let t = 0; t < 4 * P120; t += TICK_MS) {
      const seam = barSeamMs(g, t);
      if (seam === null) continue;
      // Identitas yang membuat ramp tidak pernah menggeser aksen: apa yang diprediksi klien
      // == beat yang akan diambil DO, dan beat itu benar-benar awal bar.
      expect(seam).toBe(nextBeatMs(g, t + LEAD_MS));
      // beatIndexAt membulatkan ke bawah, dan beat hasil perkalian periode bisa mendarat 1e-13
      // di bawah indeksnya; yang dituntut di sini indeksnya, bukan representasi biner periodMs.
      expect(Math.round(beatIndexAt(g, seam)) % 4).toBe(0);
    }
  });

  it('grid yang tidak masuk akal tidak menghasilkan jahitan', () => {
    const rusak: Grid[] = [
      { anchorMs: 0, periodMs: Number.POSITIVE_INFINITY },
      { anchorMs: 0, periodMs: 0 },
      { anchorMs: Number.NaN, periodMs: 500 },
    ];
    for (const g of rusak) expect(barSeamMs(g, 10_000)).toBeNull();
  });
});

describe('rampBpm', () => {
  it('satu langkah ke arah target dan berhenti tepat di target', () => {
    expect(rampBpm(120, 100)).toBe(119);
    expect(rampBpm(100, 120)).toBe(101);
    expect(rampBpm(101, 100)).toBe(100);
    expect(rampBpm(100, 100)).toBe(100);
    expect(RAMP_STEP_BPM).toBe(1);
  });

  it('tidak pernah keluar dari rentang yang diterima parseBpm', () => {
    // Server menolak bpm non-integer dan di luar 30..300; ramp yang mengirim angka itu membuat
    // pemimpin dapat frame `error` dan seluruh ruangan berhenti ganti tempo.
    for (const [from, to] of [[MIN_BPM, MIN_BPM - 20], [MAX_BPM, MAX_BPM + 20], [120, 999], [120, -5]] as const) {
      const next = rampBpm(from, to);
      expect(parseBpm(next)).toBe(next);
      expect(next).toBeGreaterThanOrEqual(MIN_BPM);
      expect(next).toBeLessThanOrEqual(MAX_BPM);
    }
  });
});

describe('ramp per bar (ADR-0002)', () => {
  it('menahan diri sampai beat terakhir sebelum garis bar, lalu satu langkah per bar', () => {
    const g = gridOf(120, 300);
    // Bar pada grid ini jatuh di 300, 2300, 4300 ms (4 beat × 500 ms).
    let s = rampStart(100);
    // Selama beat berikutnya bukan awal bar, tidak ada satu permintaan pun — termasuk seluruh
    // isi tiga bar pertama: pemimpin tidak boleh memutuskan tempo di tengah bar.
    for (let t = 0; t < 1_525; t += TICK_MS) {
      const r = rampStep(s, g, t, 120);
      expect(r.bpm).toBeNull();
      expect(r.state).toBe(s);
    }
    // 1525 → at 1825: beat berikutnya 2300 = awal bar, sisa 475 ms → langkah pertama diminta.
    const pertama = rampStep(s, g, 1_525, 120);
    expect(pertama.bpm).toBe(119);
    // Bar yang sama, ditanya 19 kali sesudahnya: tidak ada frame kedua.
    for (let t = 1_525; t < 2_000; t += TICK_MS) {
      expect(rampStep(pertama.state, g, t, 119).bpm).toBeNull();
    }
    s = pertama.state;
    // Langkah berikutnya hanya untuk awal bar sesudahnya (4300): t 3750 → at 4050, sisa 250 ms.
    expect(rampStep(s, g, 3_750, 119).bpm).toBe(118);
  });

  it('ramp 120 → 100 mengirim 119..100 lalu diam', () => {
    const g = gridOf(120, 300);
    let s = rampStart(100);
    let bpm = 120;
    const dikirim: number[] = [];
    for (let t = 0; t < 90_000; t += TICK_MS) {
      const r = rampStep(s, g, t, bpm);
      if (r.bpm === null) continue;
      s = r.state;
      bpm = r.bpm;
      dikirim.push(bpm);
    }
    expect(dikirim).toEqual(Array.from({ length: 20 }, (_, i) => 119 - i));
  });

  it('seluruh jahitan ramp: tidak ada beat terlewat, tidak ada dobel, tidak ada yang tertelan', () => {
    // Simulasi 2 sisi: "server" menghitung retune dengan LEAD_MS seperti SessionDO, frame
    // `state` mendarat 20 ms kemudian (p95 RTT lapangan), dan "klien" mengadopsi grid dengan
    // cursor yang tidak pernah mundur — persis jalur yang dilalui dua belas HP.
    const bridge = (t: number): ClockBridge => ({ wallMs: t, audioMs: t, rate: 1 });
    const serverGrid = gridOf(120, LEAD_MS);
    let clientGrid = serverGrid;
    let grid = serverGrid;
    let bpm = 120;
    let cursor = firstPlayableIndex(serverGrid, 0);
    let s = rampStart(100);
    let kirimPada = -1;
    let pending: Grid | null = null;
    const clicks: { at: number; period: number }[] = [];
    const seams: number[] = [];
    let swallowed = 0;
    let missed = 0;

    for (let t = 0; t <= 90_000; t += TICK_MS) {
      const r = rampStep(s, grid, t, bpm);
      if (r.bpm !== null) {
        s = r.state;
        const baru = serverSetTempo(grid, r.bpm, t);
        seams.push(baru.anchorMs);
        // Aksen tidak boleh bergeser: anchor server == jahitan yang diprediksi klien, dan
        // barSeamMs memilih jahitan itu lewat indeks bulat (`seamIndex % 4 === 0`). Indeks itu
        // tidak boleh diturunkan ulang lewat `beatIndexAt`: pada periode 508,47 ms,
        // floor((k·P)/P) menghasilkan k−1, dan angka 3 di sini adalah galap pembulatan itu,
        // bukan aksen yang bergeser.
        expect(baru.anchorMs).toBe(barSeamMs(grid, t) ?? Number.NaN);
        grid = baru;
        bpm = r.bpm;
        pending = baru;
        kirimPada = t + 20; // satu langkah jaringan, lalu semua HP melihat grid yang sama
      }
      if (pending && t >= kirimPada && !startsLater(pending, t)) {
        // `kirimPada` = frame `state` mendarat; serah terimanya sendiri baru terjadi saat jam
        // server menyentuh anchor, persis aturan click.ts (ADR-0004). Frame yang datang lebih
        // awal tidak boleh membuang beat grid lama di antara antrean dan anchor.
        const adopt = adoptIndex(clientGrid, cursor, pending, t);
        swallowed += adopt.swallowed;
        cursor = adopt.index;
        clientGrid = pending;
        pending = null;
      }
      const p = planBeats({
        grid: clientGrid,
        thetaMs: 0,
        bridge: bridge(t),
        latencyCompMs: 0,
        nowAudioMs: t,
        fromIndex: cursor,
        horizonMs: LOOKAHEAD_MS,
      });
      missed += p.missed;
      cursor = p.nextIndex;
      for (const j of p.jobs) clicks.push({ at: beatMs(clientGrid, j.index), period: clientGrid.periodMs });
    }

    expect(seams).toHaveLength(20);
    expect(swallowed).toBe(0);
    expect(missed).toBe(0);
    expect(clicks.length).toBeGreaterThan(100);
    for (let i = 1; i < clicks.length; i++) {
      const gap = clicks[i].at - clicks[i - 1].at;
      // `dobel` = dua klik pada momen yang sama; dua klik berjarak < 1 ms tidak bisa dibedakan telinga.
      expect(gap).toBeGreaterThan(1);
      // `terlewat` = satu beat utuh raib; kelonggaran 5 % hanya untuk pembulatan periode.
      expect(gap).toBeLessThanOrEqual(Math.max(clicks[i].period, clicks[i - 1].period) * 1.05);
    }
    // Cursor maju-saja (ADR-0003 / schedule.ts:110-113): indeks klik tak pernah boleh di bawah yang lama.
    const indeks = clicks.map((c) => c.at);
    expect(indeks).toEqual([...indeks].sort((a, b) => a - b));
  });

  it('timer 250 ms (tab di-throttle) tetap satu langkah per bar, tidak pernah dua', () => {
    // Jendela kelayakan sepanjang 3/4 periode = 375 ms pada 120 bpm: lebih lebar dari interval
    // poll ini, jadi tiap bar terkejar dan ramp selesai seperti biasa.
    const g = gridOf(120, 300);
    let s = rampStart(100);
    let bpm = 120;
    const dikirim: number[] = [];
    for (let t = 0; t < 90_000; t += 250) {
      const r = rampStep(s, g, t, bpm);
      if (r.bpm === null) continue;
      s = r.state;
      bpm = r.bpm;
      dikirim.push(bpm);
    }
    expect(dikirim).toEqual(Array.from({ length: 20 }, (_, i) => 119 - i));
  });

  it('timer 1000 ms bisa melewatkan bar, tapi tidak pernah mengirim dua angka untuk bar yang sama', () => {
    // Yang dijamin di tab beku adalah keamanannya (satu langkah per jahitan, satu arah, berhenti
    // di target), bukan kecepatannya. Kecepatan butuh poll < 3/4 periode beat: itu `shortcut:`
    // yang dicatat ADR-0002, bukan regresi.
    const g = gridOf(120, 300);
    let s = rampStart(100);
    let bpm = 120;
    const dikirim: number[] = [];
    for (let t = 0; t < 90_000; t += 1_000) {
      const r = rampStep(s, g, t, bpm);
      if (r.bpm === null) continue;
      s = r.state;
      bpm = r.bpm;
      dikirim.push(bpm);
    }
    expect(dikirim.length).toBeLessThanOrEqual(20);
    expect(new Set(dikirim).size).toBe(dikirim.length);
    for (let i = 1; i < dikirim.length; i++) expect(dikirim[i]).toBe(rampBpm(dikirim[i - 1], 100));
    for (const b of dikirim) expect(b).toBeLessThan(120);
  });
});
