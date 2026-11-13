import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
  const wsRef = useRef<WebSocket | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const say = useCallback((line: string) => setLog((prev) => [...prev, line]), []);

  useEffect(
    () => () => {
      wsRef.current?.close();
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
    { host: location.host, env: envLines(), wake, audio, runs, log },
    null,
    1
  );

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 720 }}>
      <h1 style={{ fontSize: 18 }}>ParanoidClick — spike M0</h1>
      <ul style={{ fontSize: 13, lineHeight: 1.5 }}>
        {envLines().map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>

      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={measure} disabled={running} style={btn}>
          {running ? 'Mengukur…' : `Ukur ${PING_COUNT} ping`}
        </button>
        <button onClick={probeAudio} style={btn}>
          Ukur audio
        </button>
      </p>

      <p style={{ fontSize: 13 }}>
        {running ? `sampel ${count}/${PING_COUNT}` : verdict} · run tersimpan: {runs.length}
      </p>
      <p style={{ fontSize: 13 }}>{wake}</p>

      {audio.map((l) => (
        <p key={l} style={{ fontSize: 13, margin: 2 }}>
          {l}
        </p>
      ))}

      <h2 style={{ fontSize: 15 }}>Log</h2>
      <pre style={pre}>{log.join('\n')}</pre>

      <h2 style={{ fontSize: 15 }}>Hasil (salin ke catatan)</h2>
      <textarea
        readOnly
        rows={12}
        value={exportJson}
        style={{ ...pre, width: '100%' }}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        onClick={() => void navigator.clipboard.writeText(exportJson).then(() => say('hasil disalin'))}
        style={btn}
      >
        Salin
      </button>
    </main>
  );
}

const btn: CSSProperties = {
  padding: '10px 14px',
  fontSize: 15,
  background: '#1b1b22',
  color: '#eee',
  border: '1px solid #444',
  borderRadius: 8,
};

const pre: CSSProperties = {
  background: '#111',
  color: '#8f8',
  fontSize: 12,
  padding: 10,
  borderRadius: 8,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
