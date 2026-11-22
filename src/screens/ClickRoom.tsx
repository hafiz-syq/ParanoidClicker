import { useCallback, useEffect, useRef, useState } from 'react';
import { ClickEngine, type ClickStats } from '../app/audio/click';
import { countInPlan, COUNT_WORDS } from '../app/audio/voice';
import { LiveSession, rememberTarget, type LiveTarget, type SessionState } from '../app/session/live';
import { mulaiTabGuard, type PeranTab, type TabGuard } from '../app/session/tab-guard';
import { TICK_MS, nextBarMs } from '../app/sync/schedule';
import { segarkanSesiBerjalan, setSesiBerjalan } from '../app/offline/sesi';
import { rampStart, rampStep, type RampState } from '../app/sync/ramp';
import { MAX_BPM, MIN_BPM, DEFAULT_BPM, parseBpm, gridOf, type Grid } from '../shared/tempo';
import type { Song } from '../shared/setlist';
import { BackingPlayer } from '../app/media/backingPlayer';
import { DEFAULT_MIX, Mixer, pindahOutput, type MixState } from '../app/media/mixer';
import {
  deleteTrack,
  getTrackData,
  listTracks,
  saveTrack,
  trackForSong,
  updateTrackMeta,
  type TrackMeta,
} from '../app/media/trackStore';
import { MidiController, type MidiState } from '../app/midi/midiController';
import { StatusBar } from './components/StatusBar';
import { SessionNav, type Tab } from './components/SessionNav';
import { MetronomePanel } from './components/MetronomePanel';
import { SetlistPanel } from './components/SetlistPanel';
import { TracksPanel, type AudioDevice } from './components/TracksPanel';
import { BandSyncPanel } from './components/BandSyncPanel';

export interface ClickRoomProps {
  role: 'leader' | 'follower';
  /** Pengikut selalu punya tautan; pemimpin baru punya target setelah /create atau saat lanjut sesi. */
  target?: LiveTarget;
}

/** Socket harus hidup selama ini sebelum grid server boleh diadopsi sesudah putus. */
const STABIL_MS = 400;

/**
 * Shell sesi: empat tab di atas satu engine yang sama.
 *
 * Yang tidak berubah dari versi sebelumnya: otoritas tetap di server (`lk` + `NOT_LEADER`),
 * grid tetap diadopsi lewat `pushGrid`, dan satu-satunya jalur bunyi tetap `ClickEngine`.
 * Tab hanya memindahkan kontrol, bukan menambah jalur audio kedua.
 */
export function ClickRoom(props: ClickRoomProps) {
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState('belum mulai');
  const [members, setMembers] = useState(0);
  const [ses, setSes] = useState<SessionState | null>(null);
  const [theta, setTheta] = useState<number | null>(null);
  const [rtt, setRtt] = useState<number | null>(null);
  const [age, setAge] = useState(Number.POSITIVE_INFINITY);
  const [stats, setStats] = useState<ClickStats | null>(null);
  const [comp, setComp] = useState('0');
  const [wake, setWake] = useState('belum diuji');
  /** Peringatan layar/tab disembunyikan; bertahan sesudah kembali supaya lubangnya terbaca. */
  const [layar, setLayar] = useState<string | null>(null);
  const [join, setJoin] = useState<LiveTarget | null>(props.target ?? null);
  /** Server menjawab `NOT_LEADER` terakhir kali: podium sudah dipegang `did` lain. */
  const [podiumLepas, setPodiumLepas] = useState(false);
  /** Setlist M3b — ikut di setiap frame `state`, jadi semua HP melihat daftar yang sama. */
  const [songs, setSongs] = useState<Song[]>([]);
  const [aktif, setAktif] = useState<number | null>(null);
  /** Tab kedua di HP yang sama hanya boleh menonton; audio dan transport-nya tidak boleh ikut. */
  const [peranTab, setPeranTab] = useState<PeranTab | null>(null);

  const [tab, setTab] = useState<Tab>('metronome');
  const [activeBeat, setActiveBeat] = useState(0);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [subdivision, setSubdivision] = useState(1);
  const [countInText, setCountInText] = useState<string | null>(null);

  const [tracks, setTracks] = useState<TrackMeta[]>([]);
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const [playHere, setPlayHere] = useState(props.role === 'leader');
  const [mix, setMix] = useState<MixState>(DEFAULT_MIX);
  const [mediaMsg, setMediaMsg] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [midi, setMidi] = useState<MidiState>({
    supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    inputs: [],
    outputs: [],
  });
  const [midiIn, setMidiIn] = useState('');
  const [midiOut, setMidiOut] = useState('');

  // §4 butir 6: pemimpin bukan lagi sekadar peran di URL. Yang diakui adalah HP yang MEMEGANG
  // KUNCI, dan kendalinya boleh dicabut server. Di wire tidak ada frame "kamu pemimpin" —
  // sinyal satu-satunya adalah penolakan — jadi tombolnya aktif selama `lk` dipegang dan mati
  // sejak `NOT_LEADER` pertama mendarat.
  const punyaKunci = join?.lk !== undefined;
  const leader = props.role === 'leader' && punyaKunci && !podiumLepas;
  /** bpm tujuan ramp; null = tidak ada ramp berjalan. */
  const [ramp, setRamp] = useState<number | null>(null);
  const [rampInput, setRampInput] = useState('100');

  const liveRef = useRef<LiveSession | null>(null);
  const engineRef = useRef<ClickEngine | null>(null);
  const sesRef = useRef<SessionState | null>(null);
  const gridRef = useRef<Grid | null>(null);
  const putusRef = useRef<Grid | null>(null);
  const reanchorTimerRef = useRef<number | null>(null);
  const rebaseRef = useRef<Grid | null>(null);
  const rebaseSourceRef = useRef<Grid | null>(null);
  const menungguStateRef = useRef(false);
  const rampRef = useRef<RampState | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const statsRef = useRef<ClickStats | null>(null);
  const peranTabRef = useRef<PeranTab | null>(null);
  const tabGuardRef = useRef<TabGuard | null>(null);
  const hiddenRef = useRef<{ at: number; missed: number } | null>(null);
  const startingRef = useRef(false);

  /** Birama aktif dibaca dari callback audio yang tidak ikut render ulang. */
  const meterRef = useRef(4);
  const mixerRef = useRef<Mixer | null>(null);
  const playerRef = useRef<BackingPlayer | null>(null);
  const mixRef = useRef<MixState>(DEFAULT_MIX);
  const backingTrackRef = useRef<string | null>(null);
  const countTimersRef = useRef<number[]>([]);
  const tapsRef = useRef<number[]>([]);
  const midiRef = useRef<MidiController | null>(null);
  const lastAktifRef = useRef<number | null>(null);

  const say = useCallback((line: string) => {
    if (line.includes('terputus')) {
      putusRef.current ??= gridRef.current;
      menungguStateRef.current = true;
      if (reanchorTimerRef.current !== null) {
        window.clearTimeout(reanchorTimerRef.current);
        reanchorTimerRef.current = null;
      }
    }
    setStatus(line);
    if (line.includes('NOT_LEADER')) setPodiumLepas(true);
  }, []);

  const pushGrid = useCallback((barAlign = false) => {
    const s = sesRef.current;
    const g = s && s.running && s.anchorMs !== null ? gridOf(s.bpm, s.anchorMs) : null;
    const last = gridRef.current;
    const serverNow = Date.now() + (liveRef.current?.thetaMs() ?? 0);
    if (barAlign) {
      const sejak = liveRef.current?.msSinceOpen() ?? Number.POSITIVE_INFINITY;
      if (sejak < STABIL_MS) {
        if (reanchorTimerRef.current === null) {
          reanchorTimerRef.current = window.setTimeout(() => {
            reanchorTimerRef.current = null;
            pushGrid(true);
          }, STABIL_MS - sejak + 20);
        }
        return;
      }
    }
    const rebase = rebaseRef.current;
    const sumberRebase = rebaseSourceRef.current;
    if (
      rebase &&
      g &&
      sumberRebase &&
      g.anchorMs === sumberRebase.anchorMs &&
      g.periodMs === sumberRebase.periodMs
    ) {
      return;
    }
    if (rebase) {
      rebaseRef.current = null;
      rebaseSourceRef.current = null;
    }
    if (g && last && g.anchorMs === last.anchorMs && g.periodMs === last.periodMs) {
      putusRef.current = null;
      return;
    }
    if (!g && !last) {
      putusRef.current = null;
      return;
    }
    if (barAlign && g && last && s) {
      const atMs = nextBarMs(putusRef.current ?? last, serverNow);
      if (Number.isFinite(atMs)) {
        const rebased = gridOf(s.bpm, atMs);
        gridRef.current = rebased;
        rebaseRef.current = rebased;
        rebaseSourceRef.current = g;
        putusRef.current = null;
        engineRef.current?.setGrid(rebased);
        return;
      }
    }
    putusRef.current = null;
    gridRef.current = g;
    engineRef.current?.setGrid(g);
  }, []);

  const engineFor = useCallback(() => {
    if (engineRef.current) return engineRef.current;
    const e = new ClickEngine({
      onStats: (s) => {
        statsRef.current = s;
        setStats(s);
      },
      onBeat: (index) => {
        const meter = meterRef.current;
        setActiveBeat(((index % meter) + meter) % meter);
      },
    });
    e.setMuted(peranTabRef.current === 'duplikat');
    engineRef.current = e;
    return e;
  }, []);

  /**
   * Mixer dan backing memakai AudioContext milik engine. Dibuat sesudah `unlock()` karena
   * konteksnya baru ada di gestur pengguna.
   */
  const siapkanAudio = useCallback(() => {
    const engine = engineRef.current;
    const ctx = engine?.audioContext();
    if (!engine || !ctx || mixerRef.current) return;
    const mixer = new Mixer(ctx);
    mixer.apply(mixRef.current);
    engine.setOutputs(mixer.input('click'), mixer.input('countIn'));
    mixerRef.current = mixer;
    playerRef.current = new BackingPlayer(ctx, mixer.input('backing'));
  }, []);

  /** Tunggu pemilihan tab; `null` (efek belum sempat jalan) tidak memblok aplikasi. */
  const siapkanTab = useCallback(async (): Promise<boolean> => {
    const guard = tabGuardRef.current;
    if (guard) await guard.siap;
    return peranTabRef.current !== 'duplikat';
  }, []);

  useEffect(() => {
    const guard = mulaiTabGuard();
    tabGuardRef.current = guard;
    const lepas = guard.ubah((peran) => {
      peranTabRef.current = peran;
      setPeranTab(peran);
      if (peran === 'duplikat') {
        engineRef.current?.setMuted(true);
      } else {
        engineRef.current?.setMuted(false);
        if (liveRef.current) pushGrid();
      }
    });
    return () => {
      lepas();
      guard.tutup();
      tabGuardRef.current = null;
    };
  }, [pushGrid]);

  useEffect(() => {
    meterRef.current = beatsPerBar;
    engineRef.current?.setMeter(beatsPerBar, subdivision);
  }, [beatsPerBar, subdivision]);

  useEffect(() => {
    mixRef.current = mix;
    mixerRef.current?.apply(mix);
  }, [mix]);

  useEffect(() => {
    let hidup = true;
    void listTracks().then((list) => {
      if (hidup) setTracks(list);
    });
    return () => {
      hidup = false;
    };
  }, []);

  useEffect(() => {
    const md = navigator.mediaDevices as MediaDevices | undefined;
    if (!md?.enumerateDevices) return;
    const muat = () => {
      void md
        .enumerateDevices()
        .then((list) => {
          setOutputs(
            list
              .filter((d) => d.kind === 'audiooutput')
              .map((d) => ({ id: d.deviceId, label: d.label || 'Output audio' }))
          );
        })
        .catch(() => undefined);
    };
    muat();
    md.addEventListener('devicechange', muat);
    return () => md.removeEventListener('devicechange', muat);
  }, []);

  const holdScreen = useCallback(async () => {
    if (!('wakeLock' in navigator)) {
      engineFor().setKeepAlive(true);
      setWake('wakeLock tidak ada — cadangan audio senyap');
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeRef.current = sentinel;
      engineFor().setKeepAlive(false);
      setWake(`layar ditahan (${sentinel.type})`);
      sentinel.addEventListener('release', () => {
        if (wakeRef.current === sentinel) {
          wakeRef.current = null;
          setWake('layar LEPAS — klik bisa berhenti saat layar mati');
        }
      });
    } catch (e) {
      engineFor().setKeepAlive(true);
      setWake(`gagal: ${String(e)} — cadangan audio senyap`);
    }
  }, [engineFor]);

  const openSession = useCallback(
    async (t: LiveTarget) => {
      rememberTarget(t, props.role === 'leader' && t.lk !== undefined);
      const audio = await engineFor().unlock().catch((e: unknown) => `GAGAL: ${String(e)}`);
      say(`audio: ${audio}`);
      siapkanAudio();
      if (!(await siapkanTab())) {
        engineRef.current?.setMuted(true);
        say('tab lain di HP ini menjadi pemilik audio — tab ini dibisukan, sesi tidak dibuka');
        return;
      }
      const session = new LiveSession(t, {
        onState: (s) => {
          sesRef.current = s;
          menungguStateRef.current = false;
          setSes(s);
          pushGrid(putusRef.current !== null);
        },
        onMembers: setMembers,
        onSetlist: (list, aktifId) => {
          setSongs(list);
          setAktif(aktifId);
        },
        onStatus: say,
        onTheta: (value) => {
          engineFor().setTheta(value);
          setTheta(value);
          if (!menungguStateRef.current) pushGrid(putusRef.current !== null);
        },
      });
      liveRef.current = session;
      session.connect();
      setLive(true);
      void holdScreen();
    },
    [engineFor, holdScreen, props.role, pushGrid, say, siapkanAudio, siapkanTab]
  );

  const startLeader = useCallback(async () => {
    if (peranTabRef.current === 'duplikat') {
      say('tab lain di HP ini menjadi pemilik audio — tab ini dibisukan, sesi tidak dibuat');
      return;
    }
    const audio = await engineFor().unlock().catch((e: unknown) => `GAGAL: ${String(e)}`);
    say(`audio: ${audio}`);
    if (audio.startsWith('GAGAL')) return;
    siapkanAudio();
    if (!(await siapkanTab())) {
      engineRef.current?.setMuted(true);
      say('tab lain di HP ini menjadi pemilik audio — tab ini dibisukan, sesi tidak dibuat');
      return;
    }
    try {
      const res = await fetch('/create', { method: 'POST' });
      const body = (await res.json()) as { sid?: string; token?: string; leaderKey?: string; error?: string };
      if (!res.ok || typeof body.sid !== 'string' || typeof body.token !== 'string') {
        say(`/create gagal ${res.status}: ${JSON.stringify(body)}`);
        return;
      }
      const lk = typeof body.leaderKey === 'string' ? body.leaderKey : undefined;
      const t: LiveTarget = { sid: body.sid, tok: body.token, ...(lk ? { lk } : {}) };
      setJoin(t);
      await openSession(t);
    } catch (e) {
      say(String(e));
    }
  }, [openSession, say, siapkanAudio, siapkanTab]);

  const rebut = () => {
    if (liveRef.current?.claim()) {
      setPodiumLepas(false);
      say('kendali diminta ulang dengan kunci pemimpin');
    }
  };

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setAge(liveRef.current?.thetaAgeMs() ?? Number.POSITIVE_INFINITY);
      setRtt(liveRef.current?.rttMs() ?? null);
    }, 250);
    return () => clearInterval(id);
  }, [live]);

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
      if (!liveRef.current?.tempo(step.bpm)) setRamp(null);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live, ramp, say]);

  useEffect(() => {
    setSesiBerjalan(live && ses?.running === true);
    return () => setSesiBerjalan(false);
  }, [live, ses]);

  useEffect(() => {
    if (!live || ses?.running !== true) return;
    segarkanSesiBerjalan();
    const id = setInterval(segarkanSesiBerjalan, 2_000);
    return () => clearInterval(id);
  }, [live, ses?.running]);

  useEffect(() => {
    if (!live) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        if (sesRef.current?.running) {
          hiddenRef.current = { at: Date.now(), missed: statsRef.current?.missed ?? 0 };
          setLayar('layar/tab disembunyikan — Web Audio bisa dibekukan; klik yang hilang dihitung saat kembali');
        }
        return;
      }
      void holdScreen();
      liveRef.current?.pingNow();
      const h = hiddenRef.current;
      hiddenRef.current = null;
      if (!h) return;
      const detik = Math.round((Date.now() - h.at) / 1000);
      const hilang = Math.max(0, (statsRef.current?.missed ?? 0) - h.missed);
      const ctx = statsRef.current?.ctxState ?? '?';
      setLayar(
        `kembali dari latar setelah ${detik} dtk — ${hilang} klik hilang selama layar mati, ctx=${ctx}` +
          (hilang > 0 ? '. Klik yang hilang TIDAK dibunyikan menyusul; tempo tetap dari grid server.' : '.')
      );
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [live, holdScreen]);

  useEffect(
    () => () => {
      liveRef.current?.close();
      liveRef.current = null;
      engineRef.current?.destroy();
      engineRef.current = null;
      mixerRef.current = null;
      playerRef.current = null;
      for (const id of countTimersRef.current) window.clearTimeout(id);
      countTimersRef.current = [];
      if (reanchorTimerRef.current !== null) window.clearTimeout(reanchorTimerRef.current);
      reanchorTimerRef.current = null;
      void wakeRef.current?.release().catch(() => undefined);
    },
    []
  );

  /** Backing ikut transport, tetapi hanya di HP yang memang diminta memutarnya. */
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const lagu = songs.find((s) => s.id === aktif);
    const track = lagu ? trackForSong(tracks, lagu.id, lagu.judul) : undefined;
    if (!ses?.running || !playHere || !track) {
      player.pause();
      return;
    }
    let batal = false;
    void (async () => {
      try {
        if (backingTrackRef.current !== track.id) {
          const data = await getTrackData(track.id);
          if (!data || batal) return;
          await player.load(data);
          backingTrackRef.current = track.id;
        }
        if (!batal) {
          player.play();
          setPlayingTrack(track.id);
        }
      } catch (e) {
        if (!batal) setMediaMsg(`backing gagal diputar: ${String(e)}`);
      }
    })();
    return () => {
      batal = true;
    };
  }, [ses?.running, playHere, aktif, songs, tracks]);

  useEffect(() => {
    if (!ses?.running) setActiveBeat(0);
  }, [ses?.running]);

  useEffect(() => {
    const m = midiRef.current;
    if (!m || !midiOut) return;
    if (ses?.running) m.start();
    else m.stop();
  }, [ses?.running, midiOut]);

  useEffect(() => {
    if (ses?.bpm !== undefined) midiRef.current?.setBpm(ses.bpm);
  }, [ses?.bpm]);

  useEffect(() => {
    if (aktif === null || aktif === lastAktifRef.current) return;
    lastAktifRef.current = aktif;
    const lagu = songs.find((s) => s.id === aktif);
    if (!lagu) return;
    const track = trackForSong(tracks, lagu.id, lagu.judul);
    if (track && midiOut) midiRef.current?.program(track.program);
  }, [aktif, songs, tracks, midiOut]);

  const nudge = (delta: number) => {
    const cur = sesRef.current?.bpm ?? 120;
    const next = Math.min(MAX_BPM, Math.max(MIN_BPM, cur + delta));
    if (next !== cur) liveRef.current?.tempo(next);
  };

  const tapTempo = () => {
    const now = Date.now();
    const taps = tapsRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2_000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length < 2) return;
    const span = taps[taps.length - 1] - taps[0];
    const bpm = Math.round(60_000 / (span / (taps.length - 1)));
    if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
      liveRef.current?.tempo(bpm);
      say(`tap tempo ${bpm} BPM`);
    }
  };

  const startRamp = () => {
    const goal = parseBpm(Number(rampInput));
    if (goal === null) {
      say(`ramp tidak dimulai: bpm harus bilangan ${MIN_BPM}..${MAX_BPM}`);
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

  /** Overlay count-in mengikuti jadwal audio yang sama, bukan timer sendiri. */
  const tampilCountIn = (plan: readonly { atMs: number; text: string }[], thetaMs: number) => {
    for (const id of countTimersRef.current) window.clearTimeout(id);
    countTimersRef.current = [];
    setCountInText(null);
    const label = (text: string): string => {
      const i = COUNT_WORDS.indexOf(text as (typeof COUNT_WORDS)[number]);
      return i >= 0 ? String(i + 1) : text.toUpperCase();
    };
    for (const p of plan) {
      const delay = p.atMs - thetaMs - Date.now();
      if (delay <= 0) continue;
      countTimersRef.current.push(window.setTimeout(() => setCountInText(label(p.text)), delay));
    }
    const akhir = plan[plan.length - 1];
    if (akhir) {
      countTimersRef.current.push(
        window.setTimeout(() => setCountInText(null), Math.max(0, akhir.atMs - thetaMs - Date.now() + 700))
      );
    }
  };

  const hitungMasuk = () => {
    const s = sesRef.current;
    if (!s || !s.running || s.anchorMs === null) {
      say('hitung masuk butuh klik yang sedang berjalan');
      return;
    }
    const engine = engineRef.current;
    if (!engine) {
      say('hitung masuk butuh engine audio');
      return;
    }
    const thetaMs = liveRef.current?.thetaMs() ?? 0;
    const sekarang = Date.now() + thetaMs;
    const lagu = songs.find((x) => x.id === aktif);
    const plan = countInPlan(gridOf(s.bpm, s.anchorMs), sekarang, lagu?.judul);
    const hasil = engine.scheduleCountIn(plan);
    if (hasil.scheduled === 0) {
      say(`hitung masuk tidak dijadwalkan: ${hasil.reason ?? 'tidak ada bunyi'}`);
      return;
    }
    tampilCountIn(plan, thetaMs);
    const jarak = hasil.gapsMs.length ? ` · jarak ${hasil.gapsMs.map((g) => Math.round(g)).join('/')} ms` : '';
    const lewat = hasil.skipped > 0 ? ` · ${hasil.skipped} lewat` : '';
    say(`hitung masuk audio: ${plan.map((p) => p.text).join('…')} · ${hasil.scheduled}/${hasil.requested} bunyi${jarak}${lewat}`);
  };

  const applyComp = () => {
    const ms = Number(comp);
    engineRef.current?.setLatencyComp(ms);
    say(`kompensasi latensi = ${Number.isFinite(ms) ? ms : 0} ms (klik berikutnya ikut bergeser)`);
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem('pc-cal-ms');
      if (stored !== null && live) {
        const ms = Number(stored);
        if (Number.isFinite(ms)) {
          engineRef.current?.setLatencyComp(ms);
          say(`latensi akustik otomatis diterapkan: ${ms} ms`);
        }
      }
    } catch {
      /* mode privat */
    }
  }, [live, say]);

  const imporTrack = async (files: FileList) => {
    const ctx = engineRef.current?.audioContext();
    if (!ctx) {
      setMediaMsg('audio belum aktif — mulai sesi dulu');
      return;
    }
    const baru: TrackMeta[] = [];
    for (const file of Array.from(files)) {
      try {
        const data = await file.arrayBuffer();
        const buf = await ctx.decodeAudioData(data.slice(0));
        const meta: TrackMeta = {
          id: `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
          songId: null,
          title: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          mime: file.type,
          size: file.size,
          durationMs: buf.duration * 1000,
          tuning: '',
          key: '',
          notes: '',
          program: 0,
          addedAt: Date.now(),
        };
        await saveTrack(meta, data);
        baru.push(meta);
      } catch (e) {
        setMediaMsg(`gagal impor ${file.name}: ${String(e)}`);
      }
    }
    if (baru.length > 0) {
      setTracks((prev) => [...prev, ...baru]);
      setMediaMsg(`${baru.length} track diimpor`);
    }
  };

  const putarTrack = async (id: string) => {
    const player = playerRef.current;
    if (!player) {
      setMediaMsg('audio belum aktif — mulai sesi dulu');
      return;
    }
    try {
      const data = await getTrackData(id);
      if (!data) {
        setMediaMsg('data track hilang dari penyimpanan');
        return;
      }
      await player.load(data);
      player.play();
      setPlayingTrack(id);
      setMediaMsg(null);
    } catch (e) {
      setMediaMsg(`gagal memutar: ${String(e)}`);
    }
  };

  const stopTrack = () => {
    playerRef.current?.stop();
    setPlayingTrack(null);
  };

  const hapusTrack = async (id: string) => {
    if (playingTrack === id) stopTrack();
    if (backingTrackRef.current === id) backingTrackRef.current = null;
    await deleteTrack(id);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  };

  const ubahMeta = async (id: string, patch: Partial<TrackMeta>) => {
    const baru = await updateTrackMeta(id, patch);
    if (baru) setTracks((prev) => prev.map((t) => (t.id === id ? baru : t)));
  };

  const aktifkanMidi = async () => {
    const m = midiRef.current ?? new MidiController();
    midiRef.current = m;
    const state = await m.init();
    setMidi(state);
    const out = state.outputs[0];
    if (out) {
      setMidiOut(out.id);
      m.selectOutput(out.id);
    }
    if (state.error) setMediaMsg(state.error);
  };

  const pilihMidiOut = (id: string) => {
    setMidiOut(id);
    midiRef.current?.selectOutput(id);
  };

  const pilihOutput = (id: string) => {
    const ctx = mixerRef.current?.ctx;
    if (!ctx) return;
    void pindahOutput(ctx, id).then((pesan) => setMediaMsg(pesan));
  };

  const gantiSesi = (t: LiveTarget) => {
    rememberTarget(t, false);
    location.assign(`${location.pathname}?sid=${encodeURIComponent(t.sid)}&tok=${encodeURIComponent(t.tok)}`);
  };

  const running = ses?.running === true;
  const stale = Number.isFinite(age) && age > 5_000;
  const wsOk = live && !status.startsWith('terputus') && !status.includes('socket error');
  const joinUrl = join ? `${location.origin}${location.pathname}?sid=${join.sid}&tok=${join.tok}` : '';
  const bpm = ses?.bpm ?? DEFAULT_BPM;

  return (
    <div className="shell">
      {live && (
        <StatusBar
          leader={leader}
          hasKey={punyaKunci}
          podiumLost={podiumLepas}
          live={live}
          members={members}
          wsOk={wsOk}
          theta={theta}
          onClaim={rebut}
          onResync={() => {
            liveRef.current?.pingNow();
            say('sync ulang diminta');
          }}
          onInvite={() => setTab('sync')}
        />
      )}

      {peranTab === 'duplikat' && (
        <p className="banner warn">
          Tab ParanoidClick lain di HP ini menjadi pemilik audio. Tab ini dibisukan supaya dua tab
          tidak mengklik dengan offset berbeda; tutup tab lain atau muat ulang di tab itu untuk
          mengambil alih.
        </p>
      )}

      {layar && <p className="banner warn">{layar}</p>}

      <main className="shell-main">
        {tab === 'metronome' && (
          <MetronomePanel
            live={live}
            leader={leader}
            bpm={bpm}
            running={running}
            activeBeat={activeBeat}
            beatsPerBar={beatsPerBar}
            subdivision={subdivision}
            ramp={ramp}
            rampInput={rampInput}
            countInText={countInText}
            startLabel={
              peranTab === 'duplikat'
                ? 'Tab lain memegang audio'
                : props.target
                  ? `Masuk ke sesi ${props.target.sid}`
                  : 'Buat Sesi & Bunyikan Klik'
            }
            startDisabled={peranTab === 'duplikat' || startingRef.current}
            onStartSession={() => {
              void holdScreen();
              if (startingRef.current) return;
              startingRef.current = true;
              void (props.target ? openSession(props.target) : startLeader()).finally(() => {
                startingRef.current = false;
              });
            }}
            onBpm={(next) => {
              if (next !== bpm) liveRef.current?.tempo(next);
            }}
            onNudge={nudge}
            onTransport={() => void liveRef.current?.transport(!running)}
            onTap={tapTempo}
            onCountIn={hitungMasuk}
            onMeter={(b, s) => {
              setBeatsPerBar(b);
              setSubdivision(s);
            }}
            onRampInput={setRampInput}
            onStartRamp={startRamp}
            onCancelRamp={() => setRamp(null)}
          />
        )}

        {tab === 'setlist' && (
          <SetlistPanel
            songs={songs}
            aktif={aktif}
            bpmSekarang={bpm}
            bolehUbah={leader}
            tracks={tracks}
            onTambah={(judul, bpmLagu) => liveRef.current?.laguTambah(judul, bpmLagu)}
            onHapus={(id) => liveRef.current?.laguHapus(id)}
            onGeser={(id, naik) => liveRef.current?.laguGeser(id, naik)}
            onPilih={(id) => {
              if (ramp !== null) say('ramp dibatalkan: lagu dipilih');
              setRamp(null);
              liveRef.current?.laguPilih(id);
            }}
          />
        )}

        {tab === 'tracks' && (
          <TracksPanel
            songs={songs}
            tracks={tracks}
            playingId={playingTrack}
            mix={mix}
            playHere={playHere}
            midi={midi}
            midiIn={midiIn}
            midiOut={midiOut}
            outputs={outputs}
            message={mediaMsg}
            onMix={setMix}
            onPlayHere={setPlayHere}
            onImport={(files) => void imporTrack(files)}
            onDelete={(id) => void hapusTrack(id)}
            onMeta={(id, patch) => void ubahMeta(id, patch)}
            onPlay={(id) => void putarTrack(id)}
            onStop={stopTrack}
            onMidiInit={() => void aktifkanMidi()}
            onMidiIn={setMidiIn}
            onMidiOut={pilihMidiOut}
            onOutput={pilihOutput}
          />
        )}

        {tab === 'sync' && (
          <BandSyncPanel
            joinUrl={joinUrl}
            sid={join?.sid ?? '—'}
            members={members}
            theta={theta}
            rtt={rtt}
            audioRate={stats?.audioRate ?? null}
            wsOk={wsOk}
            wake={wake}
            comp={comp}
            stats={stats}
            stale={stale}
            status={status}
            gridLine={
              ses
                ? `grid: bpm=${ses.bpm} anchor=${ses.anchorMs ?? '—'} running=${ses.running}`
                : 'grid: belum diterima dari server'
            }
            onComp={setComp}
            onApplyComp={applyComp}
            onJoin={gantiSesi}
          />
        )}
      </main>

      <SessionNav active={tab} onChange={setTab} />
    </div>
  );
}
