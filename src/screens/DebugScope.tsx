import { useCallback, useEffect, useRef, useState } from 'react';
import { laporanDrift, type DriftReport, type DriftSample } from '../app/sync/audio-drift';
import { genDid } from '../shared/ids';
import { parseFrame } from '../shared/limits';
import {
  dist,
  estimateJitter,
  estimateOffset,
  toSample,
  type Sample,
  type Stamps,
} from '../app/sync/offset';

const PING_COUNT = 60;
const PING_INTERVAL_MS = 1000;
// Dua puluh menit adalah jendela yang cukup panjang untuk memisahkan laju jam dari
// noise RTT satu menit, tetapi masih bisa dijalankan satu kali di sesi latihan.
const DRIFT_DURATION_MS = 20 * 60_000;
const DRIFT_INTERVAL_MS = 2_000;
const DRIFT_PING_TIMEOUT_MS = 1_500;

interface Run {
  at: string;
  sid: string;
  rttP50: number;
  rttP95: number;
  rttMax: number;
  offsetMs: number;
  jitterP95Ms: number;
  verdict: string;
  rejected: number;
  lost: number;
  stamps: Stamps[];
}

function verdictOf(jitterP95Ms: number): string {
  if (Number.isNaN(jitterP95Ms)) return 'belum cukup sampel (butuh 16+)';
  if (jitterP95Ms <= 15) return 'LANJUT: jitter terkendali';
  if (jitterP95Ms <= 40) return 'LANJUT dengan re-anchor mudah: jitter sedang';
  return 'BERHENTI: jitter terlalu besar, butuh fallback jam LAN';
}

function f1(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

function formatDrift(r: DriftReport): string {
  if (!r.fit) {
    return `drift: belum cukup sampel (${r.used}/${r.n}); butuh minimal 8 sampel yang valid`;
  }
  const lines = [
    `durasi ${f1(r.durationMs / 60_000)} menit · sampel ${r.used}/${r.n} ` +
      `(dibuang ${r.rejected}, hilang ${r.lost})`,
    `rtt p50=${f1(r.rttP50Ms)} p95=${f1(r.rttP95Ms)} ms`,
    `FIT ${r.fit.msPerMinute >= 0 ? '+' : ''}${r.fit.msPerMinute.toFixed(3)} ms/menit ` +
      `(${r.fit.ppm >= 0 ? '+' : ''}${r.fit.ppm.toFixed(1)} ppm) · ` +
      `total ${r.totalDriftMs >= 0 ? '+' : ''}${r.totalDriftMs.toFixed(1)} ms · ` +
      `R² ${Number.isFinite(r.fit.r2) ? r.fit.r2.toFixed(4) : '—'} · noise p95 ${f1(r.fit.residualP95Ms)} ms`,
    'positif = jam AudioContext tertinggal dari jam server',
    '',
    'menit  n   rtt p50  kumulatif  delta',
  ];
  for (const b of r.bins) {
    lines.push(
      `${String(b.minute).padStart(2, ' ')}   ${String(b.count).padStart(3, ' ')}   ` +
        `${f1(b.rttP50Ms).padStart(5, ' ')}   ` +
        `${b.cumulativeMs === null ? '     —' : `${b.cumulativeMs >= 0 ? '+' : ''}${b.cumulativeMs.toFixed(1)}`.padStart(9, ' ')}   ` +
        `${b.deltaMs === null ? '     —' : `${b.deltaMs >= 0 ? '+' : ''}${b.deltaMs.toFixed(1)}`}`
    );
  }
  return lines.join('\n');
}

function envLines(): string[] {
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari tidak mengenal display-mode.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return [
    `host=${location.host} protocol=${location.protocol}`,
    `secureContext=${window.isSecureContext}`,
    `standalone=${standalone}`,
    `serviceWorker=${'serviceWorker' in navigator}`,
    `wakeLock=${'wakeLock' in navigator}`,
    `ua=${navigator.userAgent}`,
  ];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function DebugScope() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [verdict, setVerdict] = useState('belum jalan');
  const [audio, setAudio] = useState<string[]>([]);
  const [wake, setWake] = useState('belum diuji');
  // Satu run per HP adalah bukti lapangan: tidak boleh hilang karena tombol dite twice
  // atau karena /create gagal pada percobaan berikutnya.
  const [runs, setRuns] = useState<Run[]>([]);
  const [driftRunning, setDriftRunning] = useState(false);
  const [driftCount, setDriftCount] = useState(0);
  const [driftRejected, setDriftRejected] = useState(0);
  const [driftLost, setDriftLost] = useState(0);
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
  const [driftSamples, setDriftSamples] = useState<DriftSample[]>([]);
  const [driftStatus, setDriftStatus] = useState('belum jalan');
  const wsRef = useRef<WebSocket | null>(null);
  const driftCtxRef = useRef<AudioContext | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const say = useCallback((line: string) => setLog((prev) => [...prev, line]), []);

  useEffect(
    () => () => {
      wsRef.current?.close();
      void driftCtxRef.current?.close().catch(() => undefined);
      driftCtxRef.current = null;
      void wakeRef.current?.release().catch(() => undefined);
    },
    []
  );

  const holdScreen = useCallback(
    async (label: string) => {
      if (!('wakeLock' in navigator)) {
        setWake(`wakeLock tidak ada — ${label} bisa kepotong layar tidur`);
        return;
      }
      try {
        void wakeRef.current?.release().catch(() => undefined);
        const sentinel = await navigator.wakeLock.request('screen');
        wakeRef.current = sentinel;
        setWake(`type=${sentinel.type} ditahan (${label})`);
        sentinel.addEventListener('release', () => {
          if (wakeRef.current === sentinel) setWake(`type=${sentinel.type} lepas (${label})`);
        });
      } catch (e) {
        setWake(`gagal: ${String(e)}`);
      }
    },
    []
  );

  const releaseScreen = useCallback(() => {
    const sentinel = wakeRef.current;
    wakeRef.current = null;
    void sentinel?.release().catch(() => undefined);
  }, []);

  const measure = useCallback(async () => {
    setRunning(true);
    setCount(0);
    const samples: Sample[] = [];
    const stamps: Stamps[] = [];
    const rtts: number[] = [];
    let rejected = 0;
    let lost = 0;
    // nonce → resolve untuk ping yang masih menunggu jawaban
    const waiters = new Map<number, () => void>();

    await holdScreen('pengukuran');

    let sid = '';
    let wsPath = '';
    try {
      const res = await fetch('/create', { method: 'POST' });
      const body = (await res.json()) as { sid?: string; wsPath?: string; error?: string };
      if (!res.ok || typeof body.sid !== 'string' || typeof body.wsPath !== 'string') {
        throw new Error(`/create gagal ${res.status}: ${JSON.stringify(body)}`);
      }
      sid = body.sid;
      wsPath = body.wsPath;
      say(`/create → sid=${sid}`);
    } catch (e) {
      say(String(e));
      setRunning(false);
      releaseScreen();
      return;
    }

    // wsPath sudah membawa tok hasil /create; menyusun ulang query di sini pernah jadi
    // jalur banjir DO (sid boleh dikarang bebas, tanpa token tidak ada DO yang bangkit).
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${wsPath}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener('message', (ev: MessageEvent<string>) => {
      let frame: Record<string, unknown>;
      try {
        // Frame dari server lewat gerbang yang sama dengan frame klien: tanpa ini,
        // socket jahat bisa kirim 8 MB atau __proto__ ke layar ukur.
        frame = parseFrame(ev.data);
      } catch (e) {
        say(`frame ditolak: ${String(e)}`);
        return;
      }
      if (frame.t === 'welcome') {
        say(`welcome: members=${String(frame.members)} rowsWritten=${String(frame.rowsWritten)}`);
        return;
      }
      if (frame.t === 'error') {
        say(`server menolak: ${String(frame.code)}`);
        return;
      }
      if (frame.t === 'state') {
        // Layar ukur belum memakai tempo, tapi frame ini harus tercatat sebagai keadaan,
        // bukan sebagai "frame tak terduga", supaya log lapangan tetap bisa dibaca.
        say(`state: bpm=${String(frame.bpm)} running=${String(frame.running)}`);
        return;
      }
      if (frame.t !== 'pong' || typeof frame.nonce !== 'number') {
        say(`frame tak terduga: ${ev.data.slice(0, 80)}`);
        return;
      }
      // Pong telat (ping-nya sudah dicatat hilang) atau duplikat tidak boleh masuk
      // seri: estimateJitter mengasumsikan tepat satu sampel per tick.
      if (!waiters.has(frame.nonce)) return;
      const st: Stamps = {
        t1: Number(frame.t1),
        t2: Number(frame.t2),
        t3: Number(frame.t3),
        t4: Date.now(),
      };
      const sample = toSample(st);
      // Tick dianggap selesai begitu jawabannya datang, walau sampelnya dibuang: tanpa
      // resolve di sini, timeout 1500 ms tetap jalan dan satu kejadian tercatat dua kali
      // (satu dibuang + satu hilang), sementara loop pengukuran menggantung 1,4 detik.
      waiters.get(frame.nonce)?.();
      if (!sample) {
        rejected++;
        return;
      }
      samples.push(sample);
      stamps.push(st);
      rtts.push(sample.rttMs);
      setCount(samples.length);
    });
    ws.addEventListener('error', () => say('WebSocket error (lihat tab Jaringan)'));

    await new Promise<void>((resolve) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('close', () => resolve(), { once: true });
    });
    if (ws.readyState !== WebSocket.OPEN) {
      say(`tidak bisa terhubung ke ${url}`);
      setRunning(false);
      releaseScreen();
      return;
    }

    ws.send(JSON.stringify({ t: 'hello', sid, did: genDid() }));

    for (let i = 0; i < PING_COUNT; i++) {
      if (ws.readyState !== WebSocket.OPEN) break;
      const slot = Date.now();
      await new Promise<void>((resolve) => {
        // Ping tanpa jawaban dalam 1500 ms dicatat hilang, tidak dibiarkan menggantung.
        const timeout = setTimeout(() => {
          waiters.delete(i);
          lost++;
          say(`ping ${i} hilang`);
          resolve();
        }, 1500);
        waiters.set(i, () => {
          clearTimeout(timeout);
          waiters.delete(i);
          resolve();
        });
        ws.send(JSON.stringify({ t: 'ping', nonce: i, t1: slot }));
      });
      if (i % 10 === 9) {
        // θ yang menentukan adalah estimasi bergulir, bukan bacaan sampel terakhir. Di HP pertama
        // keduanya berbeda sampai 103 ms (586,5 mentah vs 655,5–664 estimasi): mencetak yang mentah
        // saja membuat operator mengira sinkroni rusak padahal angka itu memang yang dibuang.
        const s = samples[samples.length - 1];
        const est = estimateOffset(samples);
        const raw = s ? `${s.offsetMs.toFixed(1)}ms` : '—';
        say(
          `${samples.length}/${PING_COUNT} rtt=${s ? `${s.rttMs.toFixed(1)}ms` : '—'} ` +
            `θ=${Number.isFinite(est) ? `${est.toFixed(1)}ms` : '—'} (sampel ${raw})`
        );
      }
      await sleep(Math.max(0, PING_INTERVAL_MS - (Date.now() - slot)));
    }

    ws.close(1000, 'selesai');
    releaseScreen();
    setRunning(false);

    if (samples.length < 2) {
      say('tidak ada sampel: periksa koneksi/worker');
      return;
    }
    const jitter = estimateJitter(samples);
    const rtt = dist(rtts);
    const run: Run = {
      at: new Date().toISOString(),
      sid,
      rttP50: rtt.p50,
      rttP95: rtt.p95,
      rttMax: rtt.max,
      offsetMs: estimateOffset(samples),
      jitterP95Ms: jitter,
      verdict: verdictOf(jitter),
      rejected,
      lost,
      stamps,
    };
    setRuns((prev) => [...prev, run]);
    setVerdict(run.verdict);
    say(
      `ringkas: rtt p50=${rtt.p50.toFixed(1)} p95=${rtt.p95.toFixed(1)}ms · ` +
        `θ=${run.offsetMs.toFixed(1)}ms · jitter p95=${jitter.toFixed(1)}ms` +
        `${rejected ? ` · ${rejected} sampel dibuang` : ''}${lost ? ` · ${lost} ping hilang` : ''}`
    );
    say(run.verdict);
  }, [holdScreen, releaseScreen, say]);

  const measureDrift = useCallback(async () => {
    if (driftRunning) return;
    setDriftRunning(true);
    setDriftCount(0);
    setDriftRejected(0);
    setDriftLost(0);
    setDriftReport(null);
    setDriftSamples([]);
    setDriftStatus('menyiapkan audio 20 menit…');

    const samples: DriftSample[] = [];
    let rejected = 0;
    let lost = 0;
    let ctx: AudioContext | null = null;
    let keep: { osc: OscillatorNode; gain: GainNode } | null = null;
    let ws: WebSocket | null = null;
    try {
      await holdScreen('drift 20 menit');
      ctx = new AudioContext();
      driftCtxRef.current = ctx;
      if (ctx.state !== 'running') await ctx.resume();
      if (ctx.state !== 'running') throw new Error(`AudioContext tetap ${ctx.state}`);
      const audio = ctx;
      // Timer tab bisa di-throttle, tetapi jam audio tidak boleh ikut membeku: osilator
      // tak terdengar ini menjaga konteks tetap "memutar audio" selama 20 menit.
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 40;
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      keep = { osc, gain };

      say(`drift: sr=${audio.sampleRate}Hz target=${DRIFT_DURATION_MS / 60_000} menit ping=${DRIFT_INTERVAL_MS}ms`);

      const res = await fetch('/create', { method: 'POST' });
      const body = (await res.json()) as { sid?: string; wsPath?: string; error?: string };
      if (!res.ok || typeof body.sid !== 'string' || typeof body.wsPath !== 'string') {
        throw new Error(`/create gagal ${res.status}: ${JSON.stringify(body)}`);
      }
      const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${body.wsPath}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Satu ping yang belum dijawab per waktu. `a1`/`a4` sengaja dibaca berdekatan
      // dengan t1/t4: pasangan jam audio dan stempel server harus berasal dari momen yang sama.
      const pending = new Map<number, { t1: number; a1: number; release: () => void }>();
      ws.addEventListener('message', (ev: MessageEvent<string>) => {
        let frame: Record<string, unknown>;
        try {
          frame = parseFrame(ev.data);
        } catch (e) {
          say(`drift frame ditolak: ${String(e)}`);
          return;
        }
        if (frame.t !== 'pong' || typeof frame.nonce !== 'number') return;
        const p = pending.get(frame.nonce);
        if (!p) return;
        pending.delete(frame.nonce);
        const t4 = Date.now();
        const a4 = audio.currentTime * 1000;
        const t2 = Number(frame.t2);
        const t3 = Number(frame.t3);
        const rttMs = t4 - p.t1 - (t3 - t2);
        // RTT nol sah di localhost. `a4 === a1` juga sah: currentTime diperbarui per
        // blok render (2,7 ms di 48 kHz), jadi ping lokal 1–4 ms memang bisa mendarat
        // di blok yang sama. Yang tidak sah hanya jam audio yang MUNDUR atau cap non-finite.
        if (
          !Number.isFinite(t2) ||
          !Number.isFinite(t3) ||
          !Number.isFinite(a4) ||
          !Number.isFinite(rttMs) ||
          rttMs < 0 ||
          a4 < p.a1 ||
          t4 < p.t1
        ) {
          rejected++;
          setDriftRejected(rejected);
          if (rejected <= 3) {
            say(
              `drift sampel dibuang: rtt=${rttMs.toFixed?.(1) ?? '—'}ms ` +
                `audioΔ=${(a4 - p.a1).toFixed?.(1) ?? '—'}ms t4-t1=${t4 - p.t1}ms`
            );
          }
          p.release();
          return;
        }
        samples.push({
          serverMs: (t2 + t3) / 2,
          audioMs: (p.a1 + a4) / 2,
          rttMs,
        });
        setDriftCount(samples.length);
        p.release();
      });
      ws.addEventListener('error', () => say('drift: WebSocket error (lihat tab Jaringan)'));

      await new Promise<void>((resolve) => {
        ws!.addEventListener('open', () => resolve(), { once: true });
        ws!.addEventListener('close', () => resolve(), { once: true });
      });
      if (ws.readyState !== WebSocket.OPEN) throw new Error(`tidak bisa terhubung ke ${wsUrl}`);
      ws.send(JSON.stringify({ t: 'hello', sid: body.sid, did: genDid() }));

      const started = Date.now();
      let nonce = 0;
      let lastLoggedMinute = 0;
      while (Date.now() - started < DRIFT_DURATION_MS) {
        if (ws.readyState !== WebSocket.OPEN) break;
        const slot = Date.now();
        const a1 = audio.currentTime * 1000;
        const pingNonce = nonce;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (pending.delete(pingNonce)) {
              lost++;
              setDriftLost(lost);
              say(`drift ping ${pingNonce} hilang`);
            }
            resolve();
          }, DRIFT_PING_TIMEOUT_MS);
          pending.set(pingNonce, {
            t1: slot,
            a1,
            release: () => {
              clearTimeout(timeout);
              resolve();
            },
          });
          ws!.send(JSON.stringify({ t: 'ping', nonce: pingNonce, t1: slot }));
        });
        nonce++;

        const minute = Math.floor((Date.now() - started) / 60_000);
        if (minute > lastLoggedMinute) {
          lastLoggedMinute = minute;
          const sementara = laporanDrift(samples, rejected, lost);
          const garis = sementara.fit
            ? `${sementara.fit.msPerMinute.toFixed(2)} ms/menit`
            : 'fit belum cukup';
          setDriftStatus(
            `berjalan ${minute}/${DRIFT_DURATION_MS / 60_000} mnt · sampel ${samples.length} · ` +
              `buang ${rejected} · hilang ${lost} · ${garis}`
          );
          say(`drift ${minute}/${DRIFT_DURATION_MS / 60_000} mnt: n=${samples.length} ${garis}`);
        }
        await sleep(Math.max(0, DRIFT_INTERVAL_MS - (Date.now() - slot)));
      }

      ws.close(1000, 'selesai drift');
      const report = laporanDrift(samples, rejected, lost);
      setDriftReport(report);
      setDriftSamples(samples);
      if (report.fit) {
        setDriftStatus(
          `selesai: ${report.fit.msPerMinute >= 0 ? '+' : ''}${report.fit.msPerMinute.toFixed(2)} ms/menit ` +
            `(${report.used}/${report.n} sampel, ${f1(report.durationMs / 60_000)} menit)`
        );
        say(formatDrift(report));
      } else {
        setDriftStatus(`selesai tanpa fit: ${samples.length} sampel valid, ${rejected} dibuang`);
      }
    } catch (e) {
      say(`drift gagal: ${String(e)}`);
      setDriftStatus(`gagal: ${String(e)}`);
    } finally {
      if (keep) {
        try {
          keep.osc.stop();
        } catch {
          // sudah berhenti
        }
        keep.osc.disconnect();
        keep.gain.disconnect();
      }
      if (ws) {
        ws.close(1000, 'selesai drift');
        if (wsRef.current === ws) wsRef.current = null;
      }
      const closing = ctx;
      driftCtxRef.current = null;
      ctx = null;
      if (closing) void closing.close().catch(() => undefined);
      releaseScreen();
      setDriftRunning(false);
    }
  }, [driftRunning, holdScreen, releaseScreen, say]);

  const probeAudio = useCallback(async () => {
    const out: string[] = [];
    const ctx = new AudioContext();
    const read = (label: string) => {
      const c = ctx as AudioContext & { outputLatency?: number };
      out.push(
        `${label}: base=${(ctx.baseLatency * 1000).toFixed(1)}ms ` +
          `output=${c.outputLatency === undefined ? '?' : (c.outputLatency * 1000).toFixed(1)}ms ` +
          `sr=${ctx.sampleRate} state=${ctx.state}`
      );
    };
    read('sebelum mic');
    setAudio(out);
    // Izin mic bisa tidak dijawab sama sekali (user pergi / tab latar), jadi dibatasi
    // 12 detik; jawaban yang datang telat tetap ditutup supaya lampu mic tidak menyala.
    let timedOut = false;
    const wantMic = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    wantMic.then(
      (stream) => {
        if (timedOut) stream.getTracks().forEach((track) => track.stop());
      },
      () => undefined
    );
    const timeout = sleep(12_000).then(() => {
      timedOut = true;
      throw new Error('tidak dijawab dalam 12 detik');
    });
    let stream: MediaStream | undefined;
    try {
      stream = await Promise.race([wantMic, timeout]);
      // label belum masuk tipe MediaTrackSettings di lib.dom TypeScript 5.9.
      const settings = stream.getAudioTracks()[0]?.getSettings() as
        | (MediaTrackSettings & { label?: string })
        | undefined;
      out.push(`mic: ${settings?.label ?? '?'} @ ${settings?.sampleRate ?? '?'}Hz`);
      // Graph harus benar-benar mengalir supaya outputLatency terisi.
      const src = ctx.createMediaStreamSource(stream);
      src.connect(ctx.createAnalyser());
      await sleep(600);
      read('sesudah mic');
      src.disconnect();
    } catch (e) {
      out.push(`mic: ${String(e)}`);
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      await ctx.close();
    }
    setAudio(out);
  }, []);

  const exportJson = JSON.stringify(
    {
      host: location.host,
      env: envLines(),
      wake,
      audio,
      runs,
      drift: driftReport,
      // Raw hanya di kotak hasil, bukan di tabel: angka per menit harus bisa diaudit
      // kembali tanpa percaya ringkasan alat ini.
      driftSamples,
      log,
    },
    null,
    1
  );

  return (
    <main className="wide">
      <h1>ParanoidClick — spike M0</h1>
      <ul className="note">
        {envLines().map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>

      <p className="row">
        <button onClick={measure} disabled={running || driftRunning} className="btn">
          {running ? 'Mengukur…' : `Ukur ${PING_COUNT} ping`}
        </button>
        <button onClick={() => void measureDrift()} disabled={running || driftRunning} className="btn">
          {driftRunning ? `Mengukur drift… ${driftCount} (buang ${driftRejected}, hilang ${driftLost})` : 'Ukur drift 20 menit'}
        </button>
        <button onClick={probeAudio} disabled={running || driftRunning} className="btn">
          Ukur audio
        </button>
      </p>

      <p className="note">
        {running ? `sampel ${count}/${PING_COUNT}` : verdict} · run tersimpan: {runs.length}
      </p>
      <p className="note">{wake}</p>
      <p className="note">{driftStatus}</p>

      {driftReport && (
        <>
          <h2>Drift AudioContext vs jam server</h2>
          <pre className="pre">{formatDrift(driftReport)}</pre>
          <p className="note">
            Positif = jam audio tertinggal. Angka FIT dipakai sebagai dasar kebijakan re-anchor;
            kolom kumulatif/delta adalah pemeriksaan apakah drift-nya memang linear, bukan satu
            lompatan jaringan.
          </p>
        </>
      )}

      {audio.map((l) => (
        <p key={l} className="note tight">
          {l}
        </p>
      ))}

      <h2>Log</h2>
      <pre className="pre">{log.join('\n')}</pre>

      <h2>Hasil (salin ke catatan)</h2>
      <textarea
        readOnly
        rows={12}
        value={exportJson}
        className="pre fill"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        onClick={() => void navigator.clipboard.writeText(exportJson).then(() => say('hasil disalin'))}
        className="btn"
      >
        Salin
      </button>
    </main>
  );
}
