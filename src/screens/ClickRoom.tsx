import { useCallback, useEffect, useRef, useState } from 'react';
import { ClickEngine, type ClickStats } from '../app/audio/click';
import { LiveSession, rememberTarget, type LiveTarget, type SessionState } from '../app/session/live';
import { TICK_MS } from '../app/sync/schedule';
import { rampStart, rampStep, type RampState } from '../app/sync/ramp';
import { MAX_BPM, MIN_BPM, parseBpm, gridOf, type Grid } from '../shared/tempo';

export interface ClickRoomProps {
  role: 'leader' | 'follower';
  /** Pengikut selalu punya tautan; pemimpin baru punya target setelah /create atau saat lanjut sesi. */
  target?: LiveTarget;
}

const STEPS = [-5, -1, 1, 5];

const f = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : '—');

/**
 * Layar klik. Satu komponen untuk dua peran: pemimpin membuat sesi lewat /create dan memegang
 * kendali tempo, pengikut membuka tautan join dan hanya melihat grid server. Sejak M3a otoritas
 * dijaga server (`lk` + `NOT_LEADER`); tombol pengikut tetap dimatikan di sini supaya tidak ada
 * dua belas HP yang saling menimpa tempo yang pasti ditolak server.
 */
export function ClickRoom(props: ClickRoomProps) {
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState('belum mulai');
  const [members, setMembers] = useState(0);
  const [ses, setSes] = useState<SessionState | null>(null);
  const [theta, setTheta] = useState<number | null>(null);
  const [age, setAge] = useState(Number.POSITIVE_INFINITY);
  const [stats, setStats] = useState<ClickStats | null>(null);
  const [comp, setComp] = useState('0');
  const [wake, setWake] = useState('belum diuji');
  const [join, setJoin] = useState<LiveTarget | null>(props.target ?? null);
  /** Server menjawab `NOT_LEADER` terakhir kali: podium sudah dipegang `did` lain. */
  const [podiumLepas, setPodiumLepas] = useState(false);

  // §4 butir 6: pemimpin bukan lagi sekadar peran di URL. Yang diakui adalah HP yang MEMEGANG
  // KUNCI, dan kendalinya boleh dicabut server. Di wire tidak ada frame "kamu pemimpin" —
  // sinyal satu-satunya adalah penolakan — jadi tombolnya aktif selama `lk` dipegang dan mati
  // sejak `NOT_LEADER` pertama mendarat. Pemimpin palsu tetap tidak bisa apa-apa: yang
  // memeriksa otoritas adalah server, bukan layar ini.
  const punyaKunci = join?.lk !== undefined;
  const leader = props.role === 'leader' && punyaKunci && !podiumLepas;
  /** bpm tujuan ramp; null = tidak ada ramp berjalan. */
  const [ramp, setRamp] = useState<number | null>(null);
  const [rampInput, setRampInput] = useState('100');

  const liveRef = useRef<LiveSession | null>(null);
  const engineRef = useRef<ClickEngine | null>(null);
  const sesRef = useRef<SessionState | null>(null);
  const gridRef = useRef<Grid | null>(null);
  const rampRef = useRef<RampState | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  /** Menyaring ketukan kedua pada tombol mulai: dua tap pernah melahirkan dua sid dan dua socket. */
  const startingRef = useRef(false);

  const say = useCallback((line: string) => {
    setStatus(line);
    // 'NOT_LEADER' adalah literal protokol (live.ts mencetak `server menolak: <kode>`), bukan
    // prosa layar ini: penolakan itulah bukti dari server bahwa podium sudah pindah ke `did` lain.
    if (line.includes('NOT_LEADER')) setPodiumLepas(true);
  }, []);

  const pushGrid = useCallback(() => {
    const s = sesRef.current;
    const g = s && s.running && s.anchorMs !== null ? gridOf(s.bpm, s.anchorMs) : null;
    const last = gridRef.current;
    // Set ulang grid yang sama akan memundurkan cursor engine dan menyetel beat yang
    // sudah pernah dibunyikan: klik ganda.
    if (g && last && g.anchorMs === last.anchorMs && g.periodMs === last.periodMs) return;
    if (!g && !last) return;
    gridRef.current = g;
    engineRef.current?.setGrid(g);
  }, []);

  const engineFor = useCallback(() => {
    if (engineRef.current) return engineRef.current;
    const e = new ClickEngine({ onStats: setStats });
    engineRef.current = e;
    return e;
  }, []);

  const holdScreen = useCallback(async () => {
    if (!('wakeLock' in navigator)) {
      setWake('wakeLock tidak ada di browser ini — layar bisa tidur saat klik jalan');
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeRef.current = sentinel;
      setWake(`layar ditahan (${sentinel.type})`);
      sentinel.addEventListener('release', () => {
        if (wakeRef.current === sentinel) {
          wakeRef.current = null;
          setWake('layar LEPAS — klik bisa berhenti saat layar mati');
        }
      });
    } catch (e) {
      setWake(`gagal: ${String(e)}`);
    }
  }, []);

  const openSession = useCallback(
    async (t: LiveTarget) => {
      // Peran dihitung dari target yang DIPEGANG HP ini, bukan dari state `join`: state itu
      // belum ter-render di continuation sesudah setJoin, dan memimpin tanpa menyimpan `lk`
      // berarti kehilangan podium begitu layar mati.
      rememberTarget(t, props.role === 'leader' && t.lk !== undefined);
      // unlock() wajib di sini, masih di dalam gestur tombol: AudioContext yang dibuat
      // diam-diam menghasilkan klik bisu tanpa satu pun error.
      const audio = await engineFor().unlock().catch((e: unknown) => `GAGAL: ${String(e)}`);
      say(`audio: ${audio}`);
      const session = new LiveSession(t, {
        onState: (s) => {
          sesRef.current = s;
          setSes(s);
          pushGrid();
        },
        onMembers: setMembers,
        onStatus: say,
        onTheta: (value) => {
          engineFor().setTheta(value);
          setTheta(value);
          pushGrid();
        },
      });
      liveRef.current = session;
      session.connect();
      setLive(true);
      void holdScreen();
    },
    [engineFor, holdScreen, props.role, pushGrid, say]
  );

  const startLeader = useCallback(async () => {
    // AudioContext dilahirkan SEBELUM fetch pertama. Di Safari iOS `resume()` sesudah
    // await jaringan sering ditolak, dan sesi yang berjalan bisu jauh lebih buruk daripada
    // sesi yang tidak jadi dibuat.
    const audio = await engineFor().unlock().catch((e: unknown) => `GAGAL: ${String(e)}`);
    say(`audio: ${audio}`);
    if (audio.startsWith('GAGAL')) return;
    try {
      const res = await fetch('/create', { method: 'POST' });
      const body = (await res.json()) as { sid?: string; token?: string; leaderKey?: string; error?: string };
      if (!res.ok || typeof body.sid !== 'string' || typeof body.token !== 'string') {
        say(`/create gagal ${res.status}: ${JSON.stringify(body)}`);
        return;
      }
      // `leaderKey` cuma ada di respons JSON ini — tidak pernah di `wsPath`, tidak pernah di
      // tautan join. Worker lama yang belum mencetaknya tidak membuat sesi jadi batal: HP ini
      // masuk sebagai anggota biasa, dan server memang belum bisa mengakui pemimpin apa pun.
      const lk = typeof body.leaderKey === 'string' ? body.leaderKey : undefined;
      const t: LiveTarget = { sid: body.sid, tok: body.token, ...(lk ? { lk } : {}) };
      setJoin(t);
      await openSession(t);
    } catch (e) {
      say(String(e));
    }
  }, [openSession, say]);

  /**
   * Tombol "Ambil kendali" (§3 rebut): mengirim `claim` ber-`lk` dari target, bukan dari URL.
   * Bukti keberhasilannya tidak ada di wire — yang ada hanya perintah berikutnya yang tidak
   * ditolak — jadi flag dilepas dan `say` yang mencetak penolakan kalau server tetap menolak.
   */
  const rebut = () => {
    if (liveRef.current?.claim()) {
      setPodiumLepas(false);
      say('kendali diminta ulang dengan kunci pemimpin');
    }
  };

  // Diagnostik dibaca 4x per detik; θ basi harus terlihat sebelum personil menyadarinya
  // dari telinganya sendiri.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setAge(liveRef.current?.thetaAgeMs() ?? Number.POSITIVE_INFINITY), 250);
    return () => clearInterval(id);
  }, [live]);

  // Ramp (ADR-0002) adalah penebakan frame `tempo` yang sudah ada, di sisi pemimpin: satu
  // langkah 1 BPM per bar, berhenti sendiri di angka tujuan. Timer ini hanya hidup selama
  // ramp berjalan.
  useEffect(() => {
    if (!live || ramp === null) return;
    rampRef.current = rampStart(ramp);
    const id = setInterval(() => {
      const s = sesRef.current;
      const state = rampRef.current;
      if (!s || !s.running || s.anchorMs === null || !state) return;
      const serverNow = Date.now() + (liveRef.current?.thetaMs() ?? 0);
      const step = rampStep(state, gridOf(s.bpm, s.anchorMs), serverNow, s.bpm);
      if (step.bpm === null) {
        if (s.bpm === ramp) {
          setRamp(null);
          say(`ramp selesai di ${ramp} BPM`);
        }
        return;
      }
      rampRef.current = step.state;
      // Socket putus di tengah ramp: berhenti, jangan antre dua puluh langkah untuk server.
      if (!liveRef.current?.tempo(step.bpm)) setRamp(null);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live, ramp, say]);

  // Layar tidur: OS membekukan AudioContext DAN melepas wake lock. Saat kembali, kunci
  // diminta ulang dan θ disegarkan tanpa menunggu interval 1 detik, supaya HP yang baru
  // bangun tidak ikut main di fase yang salah. Klik yang hilang selama tidur sudah
  // terhitung di diagnostik sebagai `hilang` — tidak ditumpuk untuk dibunyikan sekaligus.
  useEffect(() => {
    if (!live) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void holdScreen();
      liveRef.current?.pingNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [live, holdScreen]);

  useEffect(
    () => () => {
      liveRef.current?.close();
      liveRef.current = null;
      engineRef.current?.destroy();
      // Tanpa dinolkan, frame `state` yang sudah antre di socket bisa menyalakan timer
      // 25 ms pada engine yang konteksnya sudah ditutup — dan tidak ada yang matikan.
      engineRef.current = null;
      void wakeRef.current?.release().catch(() => undefined);
    },
    []
  );

  const nudge = (delta: number) => {
    const cur = sesRef.current?.bpm ?? 120;
    const next = Math.min(MAX_BPM, Math.max(MIN_BPM, cur + delta));
    if (next !== cur) liveRef.current?.tempo(next);
  };

  const startRamp = () => {
    const goal = parseBpm(Number(rampInput));
    if (goal === null) {
      say(`ramp tidak dimulai: bpm harus bulangan ${MIN_BPM}..${MAX_BPM}`);
      return;
    }
    const cur = sesRef.current?.bpm;
    if (cur === undefined) return;
    if (cur === goal) {
      say('ramp tidak perlu: sudah di angka itu');
      return;
    }
    setRamp(goal);
    say(`ramp ${cur} → ${goal} BPM, satu langkah per bar`);
  };

  const applyComp = () => {
    const ms = Number(comp);
    engineRef.current?.setLatencyComp(ms);
    say(`kompensasi latensi = ${Number.isFinite(ms) ? ms : 0} ms (klik berikutnya ikut bergeser)`);
  };

  const running = ses?.running === true;
  const stale = Number.isFinite(age) && age > 5_000;
  const joinUrl = join ? `${location.origin}${location.pathname}?sid=${join.sid}&tok=${join.tok}` : '';

  return (
    <main>
      <h1>ParanoidClick — {leader ? 'Pemimpin' : 'Pengikut'}</h1>

      {!live && (
        <>
          <p className="status">
            Browser hanya mengizinkan suara keluar sesudah gestur pengguna — karena itu ada tombol ini, bukan
            karena aplikasi memilihnya.
          </p>
          <button
            onClick={() => {
              if (startingRef.current) return;
              startingRef.current = true;
              void (props.target ? openSession(props.target) : startLeader()).finally(() => {
                startingRef.current = false;
              });
            }}
            className="btn btn-lg"
          >
            {props.target ? `Masuk ke sesi ${props.target.sid}` : 'Buat sesi & bunyikan klik'}
          </button>
        </>
      )}

      {live && (
        <>
          <p className="status">
            <b>{ses?.bpm ?? '–'} BPM</b> · {running ? 'jalan' : 'diam'} · {members} HP ·{' '}
            <span className={stale ? 'bad' : 'ok'}>{status}</span>
          </p>

          <p className="row">
            {STEPS.map((s) => (
              <button key={s} onClick={() => nudge(s)} disabled={!leader} className="btn">
                {s > 0 ? `+${s}` : s}
              </button>
            ))}
            <button
              onClick={() => void liveRef.current?.transport(!running)}
              disabled={!leader}
              className="btn btn-wide"
            >
              {running ? 'Stop' : 'Start'}
            </button>
          </p>

          {punyaKunci && podiumLepas && (
            <p className="row">
              <button onClick={rebut} className="btn btn-wide">
                Ambil kendali
              </button>
              <span className="bad">server tidak mengakui HP ini sebagai pemimpin</span>
            </p>
          )}

          {leader && (
            <p className="row">
              <label className="note">
                Ramp ke BPM{' '}
                <input
                  type="number"
                  value={rampInput}
                  min={MIN_BPM}
                  max={MAX_BPM}
                  onChange={(e) => setRampInput(e.currentTarget.value)}
                  className="field"
                />
              </label>
              {ramp === null ? (
                <button onClick={startRamp} disabled={!running} className="btn">
                  Mulai ramp
                </button>
              ) : (
                <button onClick={() => setRamp(null)} className="btn btn-wide">
                  Batalkan ramp → {ramp}
                </button>
              )}
            </p>
          )}

          {leader && joinUrl && (
            <>
              <h2>Tautan join (sid {join?.sid})</h2>
              <p className="pre">{joinUrl}</p>
              <p className="small">
                Kirim tautan ini ke HP lain (QR menyusul di M4). Tautan = kunci sesi: siapa pun yang
                membukanya bisa masuk ke ruangan ini.
              </p>
              <button
                onClick={() => void navigator.clipboard.writeText(joinUrl).then(() => say('tautan disalin'))}
                className="btn"
              >
                Salin tautan
              </button>
            </>
          )}

          {!punyaKunci && (
            <p className="note">
              Hanya pemimpin yang mengubah tempo, dan sejak M3a yang memeriksa itu server: HP tanpa
              kunci pemimpin tetap masuk dan mendengar, tapi tempo/start/stop darinya dijawab
              NOT_LEADER.
            </p>
          )}

          <h2>Diagnostik</h2>
          <pre className="pre">
            {[
              `θ = ${theta === null ? 'belum ada sampel' : `${theta.toFixed(1)} ms`} · umur ${
                Number.isFinite(age) ? `${age.toFixed(0)} ms` : '—'
              }${stale ? ' BASI' : ''}`,
              `θ dipakai klik = ${stats ? `${f(stats.thetaMs)} ms` : '—'} · lompat ${stats?.thetaJumps ?? 0}× · ` +
                `beat tertelan di jahitan ${stats?.swallowed ?? 0}`,
              `klik ${stats?.played ?? 0} berbunyi · ${stats?.missed ?? 0} hilang · ctx=${stats?.ctxState ?? '?'}` +
                ` · laju audio=${stats ? stats.audioRate.toFixed(3) : '?'}× jam dinding` +
                `${stats?.audioStalled ? ' · JAM AUDIO BEKU (laju terakhir dipakai, jangan percaya laju ini)' : ''}`,
              stats && stats.driftSamples > 0
                ? `meleset: p50=${f(stats.driftP50Ms)} p95=${f(stats.driftP95Ms)} max=${f(stats.driftMaxMs)} ms ` +
                  `(${stats.driftSamples} klik terakhir)\n` +
                  `kompensasi latensi = ${f(stats.latencyCompMs)} ms`
                : 'meleset: belum ada klik yang selesai dibunyikan',
              `layar: ${wake}`,
              ses
                ? `grid: bpm=${ses.bpm} anchor=${ses.anchorMs ?? '—'} running=${ses.running}`
                : 'grid: belum diterima dari server',
            ].join('\n')}
          </pre>

          <p className="row">
            <label className="note">
              Kompensasi latensi (ms){' '}
              <input type="number" value={comp} onChange={(e) => setComp(e.currentTarget.value)} className="field" />
            </label>
            <button onClick={applyComp} className="btn">
              Terapkan
            </button>
          </p>
        </>
      )}

      <p className="foot">
        <a href="/">← halaman depan</a> ·{' '}
        <a href="/?layar=ukur">alat ukur spike M0</a>
      </p>
    </main>
  );
}
