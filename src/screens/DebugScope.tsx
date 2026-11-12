import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { genDid } from '../shared/ids';
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

interface Summary {
  rtt: { p50: number; p95: number; max: number };
  offsetMs: number;
  jitterP95Ms: number;
  verdict: string;
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
  const [done, setDone] = useState<Summary | null>(null);
  const [count, setCount] = useState(0);
  const [audio, setAudio] = useState<string[]>([]);
  const [wake, setWake] = useState('belum diuji');
  const wsRef = useRef<WebSocket | null>(null);
  // cap mentah per ping ikut diekspor: re-analisis di laptop tidak perlu mengulang tes di HP
  const stampsRef = useRef<Stamps[]>([]);
  const say = useCallback((line: string) => setLog((prev) => [...prev, line]), []);

  useEffect(() => () => wsRef.current?.close(), []);

  const measure = useCallback(async () => {
    setRunning(true);
    setDone(null);
    setCount(0);
    const samples: Sample[] = [];
    const stamps: Stamps[] = [];
    const rtts: number[] = [];
    stampsRef.current = stamps;
    // nonce → pemanggil resolve untuk ping yang sedang menunggu jawaban
    const waiters = new Map<number, () => void>();

    let sid = '';
    try {
      const res = await fetch('/create', { method: 'POST' });
      const body = (await res.json()) as { sid?: string; error?: string };
      if (!res.ok || typeof body.sid !== 'string') {
        throw new Error(`/create gagal ${res.status}: ${JSON.stringify(body)}`);
      }
      sid = body.sid;
      say(`/create → sid=${sid}`);
    } catch (e) {
      say(String(e));
      setRunning(false);
      return;
    }

    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?sid=${sid}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener('message', (ev: MessageEvent<string>) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        say(`frame tidak terurai: ${ev.data.slice(0, 60)}`);
        return;
      }
      if (frame.t === 'welcome') {
        say(`welcome: members=${String(frame.members)} rowsWritten=${String(frame.rowsWritten)}`);
        return;
      }
      if (frame.t !== 'pong' || typeof frame.nonce !== 'number') {
        say(`frame tak terduga: ${ev.data.slice(0, 80)}`);
        return;
      }
      const st: Stamps = {
        t1: Number(frame.t1),
        t2: Number(frame.t2),
        t3: Number(frame.t3),
        t4: Date.now(),
      };
      const sample = toSample(st);
      samples.push(sample);
      stamps.push(st);
      rtts.push(sample.rttMs);
      setCount(samples.length);
      waiters.get(frame.nonce)?.();
    });
    ws.addEventListener('error', () => say('WebSocket error (lihat tab Jaringan)'));

    await new Promise<void>((resolve) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('close', () => resolve(), { once: true });
    });
    if (ws.readyState !== WebSocket.OPEN) {
      say(`tidak bisa terhubung ke ${url}`);
      setRunning(false);
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
        const s = samples[samples.length - 1];
        say(`${samples.length}/${PING_COUNT} rtt=${s?.rttMs.toFixed(1)}ms θ=${s?.offsetMs.toFixed(1)}ms`);
      }
      await sleep(Math.max(0, PING_INTERVAL_MS - (Date.now() - slot)));
    }

    ws.close(1000, 'selesai');
    setRunning(false);
    if (samples.length < 2) {
      say('tidak ada sampel: periksa koneksi/worker');
      return;
    }
    const jitter = estimateJitter(samples);
    const summary: Summary = {
      rtt: dist(rtts),
      offsetMs: estimateOffset(samples),
      jitterP95Ms: jitter,
      verdict: verdictOf(jitter),
    };
    setDone(summary);
    say(
      `ringkas: rtt p50=${summary.rtt.p50.toFixed(1)} p95=${summary.rtt.p95.toFixed(1)}ms · ` +
        `θ=${summary.offsetMs.toFixed(1)}ms · jitter p95=${jitter.toFixed(1)}ms`
    );
  }, [say]);

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
    try {
      const stream = await Promise.race([wantMic, timeout]);
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
      stream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      out.push(`mic: ${String(e)}`);
    }
    await ctx.close();
    setAudio(out);
  }, []);

  const probeWake = useCallback(async () => {
    if (!('wakeLock' in navigator)) {
      setWake('navigator.wakeLock tidak ada');
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // isVisible tidak ada di semua build Chrome, jadi keberhasilan request yang dilaporkan.
      setWake(`type=${sentinel.type} — layar ditahan 60 detik lalu lepas sendiri`);
      sentinel.addEventListener('release', () => setWake(`type=${sentinel.type} — sudah lepas`));
      setTimeout(() => void sentinel.release().catch(() => undefined), 60_000);
    } catch (e) {
      setWake(`gagal: ${String(e)}`);
    }
  }, []);

  const exportJson = JSON.stringify(
    { host: location.host, count, done, stamps: stampsRef.current, env: envLines(), audio, log },
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
        <button onClick={probeWake} style={btn}>
          Uji wake lock
        </button>
      </p>

      <p style={{ fontSize: 13 }}>
        {running ? `sampel ${count}/${PING_COUNT}` : done ? done.verdict : 'belum jalan'}
      </p>

      {audio.map((l) => (
        <p key={l} style={{ fontSize: 13, margin: 2 }}>
          {l}
        </p>
      ))}
      <p style={{ fontSize: 13 }}>{wake}</p>

      <h2 style={{ fontSize: 15 }}>Log</h2>
      <pre style={pre}>{log.join('\n')}</pre>

      <h2 style={{ fontSize: 15 }}>Hasil (salin ke catatan)</h2>
      <textarea readOnly rows={10} value={exportJson} style={{ ...pre, width: '100%' }} />
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
