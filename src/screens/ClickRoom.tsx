import { useCallback, useEffect, useRef, useState } from 'react';
import { ClickEngine, type ClickStats } from '../app/audio/click';
import { countInPlan } from '../app/audio/voice';
import { LiveSession, rememberTarget, type LiveTarget, type SessionState } from '../app/session/live';
import { mulaiTabGuard, type PeranTab, type TabGuard } from '../app/session/tab-guard';
import { TICK_MS, nextBarMs } from '../app/sync/schedule';
import { segarkanSesiBerjalan, setSesiBerjalan } from '../app/offline/sesi';
import { rampStart, rampStep, type RampState } from '../app/sync/ramp';
import { MAX_BPM, MIN_BPM, DEFAULT_BPM, parseBpm, gridOf, type Grid } from '../shared/tempo';
import type { Song } from '../shared/setlist';
import { JoinQr } from './JoinQr';
import { Setlist } from './Setlist';

export interface ClickRoomProps {
  role: 'leader' | 'follower';
  /** Pengikut selalu punya tautan; pemimpin baru punya target setelah /create atau saat lanjut sesi. */
  target?: LiveTarget;
}

const STEPS = [-5, -1, 1, 5];
/** Socket harus hidup selama ini sebelum grid server boleh diadopsi sesudah putus. */
const STABIL_MS = 400;

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
  /**
   * Grid yang sedang berbunyi saat socket putus. Diisi saat putus dan baru dikosongkan ketika
   * re-anchor benar-benar diputuskan — bukan oleh frame pertama, karena socket yang flap bisa
   * sempat hidup 20 ms lalu mati lagi.
   */
  const putusRef = useRef<Grid | null>(null);
  /** Timer menunggu socket stabil sebelum mengadopsi grid. */
  const reanchorTimerRef = useRef<number | null>(null);
  /** Grid hasil re-anchor bar yang belum mencapai anchor-nya; menahan frame server sesaat. */
  const rebaseRef = useRef<Grid | null>(null);
  /** State server yang memicu re-anchor; frame state/pong yang sama tidak boleh menggesernya. */
  const rebaseSourceRef = useRef<Grid | null>(null);
  /** Sesudah putus, tunggu frame `state` yang baru sebelum memakai grid server untuk re-anchor. */
  const menungguStateRef = useRef(false);
  const rampRef = useRef<RampState | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const statsRef = useRef<ClickStats | null>(null);
  /** Salinan peran untuk callback async; state React bisa tertinggal satu render. */
  const peranTabRef = useRef<PeranTab | null>(null);
  const tabGuardRef = useRef<TabGuard | null>(null);
  /** Keadaan saat tab disembunyikan: kapan, dan berapa klik sudah hilang. */
  const hiddenRef = useRef<{ at: number; missed: number } | null>(null);
  /** Menyaring ketukan kedua pada tombol mulai: dua tap pernah melahirkan dua sid dan dua socket. */
  const startingRef = useRef(false);

  const say = useCallback((line: string) => {
    if (line.includes('terputus')) {
      // Grid saat putus disimpan SEKALI; percobaan sambung yang langsung mati tidak boleh
      // menghapusnya, karena garis bar dihitung dari grid yang benar-benar didengar band.
      putusRef.current ??= gridRef.current;
      menungguStateRef.current = true;
      if (reanchorTimerRef.current !== null) {
        window.clearTimeout(reanchorTimerRef.current);
        reanchorTimerRef.current = null;
      }
    }
    setStatus(line);
    // 'NOT_LEADER' adalah literal protokol (live.ts mencetak `server menolak: <kode>`), bukan
    // prosa layar ini: penolakan itulah bukti dari server bahwa podium sudah pindah ke `did` lain.
    if (line.includes('NOT_LEADER')) setPodiumLepas(true);
  }, []);

  const pushGrid = useCallback((barAlign = false) => {
    const s = sesRef.current;
    const g = s && s.running && s.anchorMs !== null ? gridOf(s.bpm, s.anchorMs) : null;
    const last = gridRef.current;
    const serverNow = Date.now() + (liveRef.current?.thetaMs() ?? 0);
    // Socket yang baru terbuka belum tentu stabil: dalam pengujian, percobaan yang hidup 20 ms
    // sempat mengadopsi grid server sebelum putus lagi. Selama masa stabil, grid lama terus
    // berbunyi dan adopsi ditunda; putus berikutnya membatalkan timer ini.
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
    // Grid hasil re-anchor bar tetap berhak sampai server benar-benar mengirim grid yang baru.
    // Pong dan frame state lama tidak boleh mengembalikan anchor server yang lebih tua; kalau
    // itu terjadi, garis bar yang sudah dipilih hilang dan beat di jahitannya tertelan.
    const rebase = rebaseRef.current;
    const sumberRebase = rebaseSourceRef.current;
    // Stop tetap menang: penjagaan ini hanya menahan grid server, bukan `running:false`.
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
    // Set ulang grid yang sama akan memundurkan cursor engine dan menyetel beat yang
    // sudah pernah dibunyikan: klik ganda.
    if (g && last && g.anchorMs === last.anchorMs && g.periodMs === last.periodMs) {
      putusRef.current = null;
      return;
    }
    if (!g && !last) {
      putusRef.current = null;
      return;
    }
    // Kembali dari putus dengan tempo baru: serah terima di garis bar grid yang sedang berbunyi,
    // bukan di beat berikutnya. Engine sudah menunda grid ber-anchor masa depan (ADR-0004), jadi
    // beat lama tetap disetel sampai garis itu — tidak ada klik bolong maupun ganda.
    // Anchor yang berubah dengan tempo sama juga harus dijahit di garis bar: worker yang lahir
    // ulang bisa memakai anchor baru tanpa mengubah bpm.
    if (barAlign && g && last && s) {
      // Bar dihitung dari grid saat putus, bukan dari gridRef yang mungkin sudah tercemar
      // percobaan sambung sebelumnya.
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
    });
    // Tab duplikat tetap boleh punya engine untuk diagnostik, tetapi tidak boleh satu klik pun.
    e.setMuted(peranTabRef.current === 'duplikat');
    engineRef.current = e;
    return e;
  }, []);

  /** Tunggu pemilihan tab; `null` (efek belum sempat jalan) tidak memblok aplikasi. */
  const siapkanTab = useCallback(async (): Promise<boolean> => {
    const guard = tabGuardRef.current;
    if (guard) await guard.siap;
    return peranTabRef.current !== 'duplikat';
  }, []);

  // BroadcastChannel hanya untuk tab pada origin yang sama. Tab pertama menjadi pemilik audio;
  // tab kedua dibisukan, bukan sekadar diberi tahu, supaya dua ClickEngine dengan θ berbeda
  // tidak pernah berbunyi bersamaan di satu HP.
  useEffect(() => {
    const guard = mulaiTabGuard();
    tabGuardRef.current = guard;
    const lepas = guard.ubah((peran) => {
      peranTabRef.current = peran;
      setPeranTab(peran);
      if (peran === 'duplikat') {
        engineRef.current?.setMuted(true);
      } else {
        // Kalau tab ini sebelumnya sempat dibisukan lalu pemilik lama pergi, pasang lagi grid
        // yang sedang berjalan; tanpa ini engine tetap diam sampai frame `state` berikutnya.
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

  const holdScreen = useCallback(async () => {
    if (!('wakeLock' in navigator)) {
      engineFor().setKeepAlive(true);
      setWake('wakeLock tidak ada di browser ini — cadangan: audio senyap (tab tidak di-throttle, layar tetap bisa tidur)');
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
      setWake(`gagal: ${String(e)} — cadangan: audio senyap (tab tidak di-throttle, layar tetap bisa tidur)`);
    }
  }, [engineFor]);

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
      // Jangan buka sesi kedua di tab duplikat. Pemeriksaan setelah unlock menjaga gestur audio
      // tetap berada di jalur yang sama seperti sebelumnya, tanpa menunda resume() dengan timer
      // pemilihan tab (penting di Safari iOS).
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
          // Pong/welcome sebelum frame state sesudah putus masih membawa grid lama. Jangan
          // memakai grid itu untuk re-anchor; tunggu `onState` yang baru. Sesudah state masuk,
          // putusRef sudah kosong dan pong hanya menjalankan jalur biasa.
          if (!menungguStateRef.current) pushGrid(putusRef.current !== null);
        },
      });
      liveRef.current = session;
      session.connect();
      setLive(true);
      void holdScreen();
    },
    [engineFor, holdScreen, props.role, pushGrid, say, siapkanTab]
  );

  const startLeader = useCallback(async () => {
    if (peranTabRef.current === 'duplikat') {
      say('tab lain di HP ini menjadi pemilik audio — tab ini dibisukan, sesi tidak dibuat');
      return;
    }
    // AudioContext dilahirkan SEBELUM fetch pertama. Di Safari iOS `resume()` sesudah
    // await jaringan sering ditolak, dan sesi yang berjalan bisu jauh lebih buruk daripada
    // sesi yang tidak jadi dibuat.
    const audio = await engineFor().unlock().catch((e: unknown) => `GAGAL: ${String(e)}`);
    say(`audio: ${audio}`);
    if (audio.startsWith('GAGAL')) return;
    // Pemilihan tab bisa selesai sesudah tombol ditekan. Cek lagi sebelum fetch /create; unlock
    // sudah dilakukan di gestur, jadi menunggu di sini tidak membahayakan AudioContext.
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
  }, [openSession, say, siapkanTab]);

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

  // Versi baru tidak boleh mengambil alih di tengah lagu: banner menahan tombol muat ulang selama
  // grid berjalan. Yang menyalakan tanda ini hanya layar klik, dan hanya dari keadaan server.
  useEffect(() => {
    setSesiBerjalan(live && ses?.running === true);
    return () => setSesiBerjalan(false);
  }, [live, ses]);

  // Cap waktu lintas tab diperbarui tiap 2 detik: tab lain (mis. halaman depan) memakainya untuk
  // menahan tawaran muat ulang selama lagu ini masih berbunyi.
  useEffect(() => {
    if (!live || ses?.running !== true) return;
    segarkanSesiBerjalan();
    const id = setInterval(segarkanSesiBerjalan, 2_000);
    return () => clearInterval(id);
  }, [live, ses?.running]);

  // Layar tidur: OS membekukan AudioContext DAN melepas wake lock. Saat kembali, kunci
  // diminta ulang dan θ disegarkan tanpa menunggu interval 1 detik, supaya HP yang baru
  // bangun tidak ikut main di fase yang salah. Klik yang hilang selama tidur sudah
  // terhitung di diagnostik sebagai `hilang` — tidak ditumpuk untuk dibunyikan sekaligus.
  // Yang tidak boleh terjadi: layar mati lalu klik berhenti tanpa satu pun kalimat.
  useEffect(() => {
    if (!live) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        // Waktu dan `missed` dicatat dari engine, bukan dari state React yang bisa tertinggal
        // satu tick. Peringatannya baru terbaca saat layar menyala lagi — memang begitu.
        if (sesRef.current?.running) {
          hiddenRef.current = { at: Date.now(), missed: statsRef.current?.missed ?? 0 };
          setLayar('layar/tab disembunyikan — Web Audio bisa dibekukan; jumlah klik yang hilang dihitung saat kembali');
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
      // Tanpa dinolkan, frame `state` yang sudah antre di socket bisa menyalakan timer
      // 25 ms pada engine yang konteksnya sudah ditutup — dan tidak ada yang matikan.
      engineRef.current = null;
      if (reanchorTimerRef.current !== null) window.clearTimeout(reanchorTimerRef.current);
      reanchorTimerRef.current = null;
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

  /**
   * Hitung masuk (M5): "Intro… one… two… three… four" mulai di downbeat berikutnya. Yang
   * dijadwalkan bukan ucapan: lima penanda bunyi masuk ke AudioContext yang sama dengan klik,
   * memakai bridge/θ/kompensasi yang sama. Jadi tidak ada jam kedua dari speechSynthesis atau
   * setTimeout yang bisa membuat kata di dua HP melenceng, dan hitungan tetap bekerja offline.
   */
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
    const theta = liveRef.current?.thetaMs() ?? 0;
    const sekarang = Date.now() + theta;
    // Judul lagu aktif, bukan selalu "Intro": hitungan yang menyebut lagu yang salah adalah
    // hitungan yang membuat band masuk di bagian yang salah.
    const plan = countInPlan(gridOf(s.bpm, s.anchorMs), sekarang, songs.find((s) => s.id === aktif)?.judul);
    // Tekan dua kali = penanda lama dihentikan oleh engine, bukan dibunyikan bertumpuk.
    const hasil = engine.scheduleCountIn(plan);
    if (hasil.scheduled === 0) {
      say(`hitung masuk tidak dijadwalkan: ${hasil.reason ?? 'tidak ada bunyi'}`);
      return;
    }
    // Jarak ini adalah jarak jadwal yang benar-benar masuk antrean AudioContext; angka yang
    // sama dipakai tes M5 untuk memastikan lima penanda tidak menumpuk atau melebar.
    const jarak = hasil.gapsMs.length ? ` · jarak ${hasil.gapsMs.map((g) => Math.round(g)).join('/')} ms` : '';
    const lewat = hasil.skipped > 0 ? ` · ${hasil.skipped} lewat` : '';
    say(`hitung masuk audio: ${plan.map((p) => p.text).join('…')} · ${hasil.scheduled}/${hasil.requested} bunyi${jarak}${lewat}`);
  };

  const applyComp = () => {
    const ms = Number(comp);
    engineRef.current?.setLatencyComp(ms);
    say(`kompensasi latensi = ${Number.isFinite(ms) ? ms : 0} ms (klik berikutnya ikut bergeser)`);
  };

  const running = ses?.running === true;
  const stale = Number.isFinite(age) && age > 5_000;
  const joinUrl = join ? `${location.origin}${location.pathname}?sid=${join.sid}&tok=${join.tok}` : '';
  const laguAktif = songs.find((s) => s.id === aktif) ?? null;

  return (
    <main>
      <h1>ParanoidClick — {leader ? 'Pemimpin' : 'Pengikut'}</h1>

      {peranTab === 'duplikat' && (
        <p className="warn">
          Tab ParanoidClick lain di HP ini menjadi pemilik audio. Tab ini dibisukan supaya dua tab
          tidak mengklik dengan offset berbeda; tutup tab lain atau muat ulang di tab itu untuk
          mengambil alih.
        </p>
      )}

      {!live && (
        <>
          <p className="status">
            Browser hanya mengizinkan suara keluar sesudah gestur pengguna — karena itu ada tombol ini, bukan
            karena aplikasi memilihnya.
          </p>
          <button
            onClick={() => {
              // Wake lock diminta paling awal, masih di gestur yang sama: `await unlock()` di
              // bawah sudah cukup untuk membuat iOS menganggap gesturnya lewat.
              void holdScreen();
              if (startingRef.current) return;
              startingRef.current = true;
              void (props.target ? openSession(props.target) : startLeader()).finally(() => {
                startingRef.current = false;
              });
            }}
            disabled={peranTab === 'duplikat'}
            className="btn btn-lg"
          >
            {peranTab === 'duplikat'
              ? 'Tab lain memegang audio'
              : props.target
                ? `Masuk ke sesi ${props.target.sid}`
                : 'Buat sesi & bunyikan klik'}
          </button>
        </>
      )}

      {live && (
        <>
          <p className="status">
            <b>{ses?.bpm ?? '–'} BPM</b> · {running ? 'jalan' : 'diam'} · {members} HP ·{' '}
            <span className={stale ? 'bad' : 'ok'}>{status}</span>
          </p>

          {layar && <p className="warn">{layar}</p>}

          {laguAktif && (
            <p className="status">
              Lagu: <b>{laguAktif.judul}</b> · {laguAktif.bpm} BPM
            </p>
          )}

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
              <button onClick={hitungMasuk} disabled={!running || peranTab === 'duplikat'} className="btn">
                Hitung masuk
              </button>
            </p>
          )}

          {leader && joinUrl && (
            <>
              <h2>Tautan join (sid {join?.sid})</h2>
              <JoinQr url={joinUrl} />
              <p className="pre">{joinUrl}</p>
              <p className="small">
                Pindai QR ini dari dalam app di HP lain (tombol <b>Pindai QR pemimpin</b> di halaman depan).
                Tautan = kunci sesi: siapa pun yang membukanya bisa masuk ke ruangan ini. Kunci pemimpin tidak
                pernah ikut di sini.
              </p>
              <button
                onClick={() => void navigator.clipboard.writeText(joinUrl).then(() => say('tautan disalin'))}
                className="btn"
              >
                Salin tautan
              </button>
            </>
          )}

          <Setlist
            songs={songs}
            aktif={aktif}
            bpmSekarang={ses?.bpm ?? DEFAULT_BPM}
            bolehUbah={leader}
            onTambah={(judul, bpm) => liveRef.current?.laguTambah(judul, bpm)}
            onHapus={(id) => liveRef.current?.laguHapus(id)}
            onGeser={(id, naik) => liveRef.current?.laguGeser(id, naik)}
            onPilih={(id) => {
              // Ramp hidup di layar ini saja, jadi pembatalannya milik tombol ini — bukan ditebak
              // dari perubahan id lagu di frame `state`. Itu juga menutup kasus memilih lagu yang
              // SAMA dua kali: id-nya tidak berubah, tapi tempo lagu tetap harus menang atas
              // target ramp lama. Menghapus lagu aktif tidak membatalkan apa pun: tempo tidak
              // berubah oleh hapus, jadi ramp yang sedang jalan tetap sah.
              if (ramp !== null) say('ramp dibatalkan: lagu dipilih');
              setRamp(null);
              liveRef.current?.laguPilih(id);
            }}
          />

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
