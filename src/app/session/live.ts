import { genDid, isSid } from '../../shared/ids';
import { FrameReject, parseFrame } from '../../shared/limits';
import { parseBpm } from '../../shared/tempo';
import { parseSetlist, parseSongId, type Song } from '../../shared/setlist';
import { estimateOffset, toSample, type Sample, type Stamps } from '../sync/offset';

export interface SessionState {
  bpm: number;
  anchorMs: number | null;
  running: boolean;
}

export interface LiveOptions {
  onState: (s: SessionState) => void;
  onMembers: (n: number) => void;
  /** Setlist dari frame `state`; `aktif` = id lagu yang sedang dipakai, null kalau belum dipilih. */
  onSetlist?: (songs: Song[], aktif: number | null) => void;
  onStatus: (line: string) => void;
  /** θ baru tiap pong; engine membacanya sekali per detik, bukan 40 kali. */
  onTheta: (thetaMs: number) => void;
}

export interface LiveTarget {
  sid: string;
  /** 64 hex — kapabilitas sesi dari /create (leader) atau dari tautan join (follower). */
  tok: string;
  /**
   * 64 hex — kapabilitas PEMIMPIN (ADR-0005). Hanya ada di HP yang memanggil `/create`
   * (atau yang menyimpannya dari sana): tautan join dan QR tidak pernah memuatnya, dan
   * `parseTarget` sengaja tidak pernah membacanya dari URL.
   */
  lk?: string;
}

const PING_INTERVAL_MS = 1_000;
const PING_TIMEOUT_MS = 1_500;
// 4x windowSize estimateJitter: lebih tua dari ini bukan lagi keadaan jaringan sekarang,
// dan sampel lama ber-delay kecil akan mengunci θ di angka yang sudah tidak benar.
const SAMPLE_WINDOW = 32;
// Anchor adalah waktu dinding server. Yang jauh lebih dari setengah hari dari jam HP bukan
// lagi sesi ini — itu server yang kehilangan clock, dan klik tidak boleh mengejarnya.
const ANCHOR_SANE_MS = 12 * 3_600_000;
const TOKEN_RE = /^[0-9a-f]{64}$/;

export function parseTarget(search: string): LiveTarget | null {
  const q = new URLSearchParams(search);
  const sid = q.get('sid');
  const tok = q.get('tok') ?? '';
  // Hanya sid + tok: `lk` TIDAK PERNAH dibaca dari URL, supaya tautan join yang dibagikan
  // tidak pernah bisa membawa kapabilitas pemimpin meskipun ada yang menempelkannya manual.
  if (!isSid(sid) || !TOKEN_RE.test(tok)) return null;
  return { sid, tok };
}

/**
 * Isi QR / teks yang ditempel: alamat lengkap `…/?sid=…&tok=…`, bukan query string saja.
 * Pemindai meneruskan apa pun yang terbaca, jadi gerbangnya tetap `parseTarget` — QR dari
 * aplikasi lain, tautan tanpa token, dan teks iseng semuanya ditolak di sini.
 */
export function targetFromUrl(text: string): LiveTarget | null {
  try {
    return parseTarget(new URL(text, location.origin).search);
  } catch {
    return null;
  }
}

/**
 * Satu socket + estimasi θ yang terus diperbarui. Klik tidak pernah menunggu socket:
 * saat koneksi putus, sesi freewheel dari grid terakhir dan θ berhenti menua —
 * itu jalur pemulihan, bukan kegagalan.
 */
export class LiveSession {
  private ws: WebSocket | null = null;
  private samples: Sample[] = [];
  private pending = new Map<number, ReturnType<typeof setTimeout>>();
  private nonce = 0;
  private attempt = 0;
  private closedByUser = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private lastPongAt = 0;
  /** Kapan socket ini benar-benar OPEN; dipakai layar untuk membedakan sambung stabil dari flap. */
  private openedAt = 0;
  /** Tebakan θ dari `welcome.serverNow`: server − lokal, tanpa koreksi perjalanan. */
  private seedMs: number | null = null;
  private readonly url: string;
  // shortcut: identitas disimpan di localStorage supaya reload tidak melahirkan member
  // hantu (12 slot sesi bisa terisi diri sendiri). Sewa member + pengusiran: M3.
  private readonly did: string = readDid();

  constructor(
    private readonly target: LiveTarget,
    private readonly opts: LiveOptions
  ) {
    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?sid=${target.sid}&tok=${target.tok}`;
  }

  connect(): void {
    if (this.ws || this.closedByUser) return;
    this.opts.onStatus(
      this.attempt === 0 ? `menghubungkan ${this.target.sid}…` : `percobaan lagi ke-${this.attempt + 1}…`
    );
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.openedAt = Date.now();
      this.opts.onStatus('terhubung');
      // `lk` hanya ikut kalau target memang punya: server membedakan "tidak punya kunci"
      // dari "kunci rusak" lewat ada/tidaknya key ini, bukan lewat string kosong.
      const hello: Record<string, unknown> = { t: 'hello', sid: this.target.sid, did: this.did };
      if (this.target.lk) hello.lk = this.target.lk;
      ws.send(JSON.stringify(hello));
      this.startPings();
    });
    ws.addEventListener('message', (ev: MessageEvent<string>) => this.onMessage(ev.data));
    ws.addEventListener('error', () => this.opts.onStatus('socket error (lihat tab Jaringan)'));
    ws.addEventListener('close', (ev) => {
      this.stopPings();
      this.ws = null;
      this.openedAt = 0;
      // Sampel dari sebelum putus tidak lagi menggambarkan rute sekarang; dicampur dengan
      // pong pertama sesudah reconnect justru mengunci θ di angka lama (median 4 delay
      // terkecil hampir selalu milik rute yang dulu).
      this.samples = [];
      for (const t of this.pending.values()) clearTimeout(t);
      this.pending.clear();
      if (this.closedByUser) return;
      this.opts.onStatus(`terputus (${ev.code}) — klik jalan terus dari grid terakhir`);
      const backoff = Math.min(30_000, 1_000 * 2 ** this.attempt++);
      this.retry = setTimeout(() => {
        this.retry = null;
        this.connect();
      }, backoff);
    });
  }

  close(): void {
    this.closedByUser = true;
    this.stopPings();
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.ws?.close(1000, 'tutup');
    this.ws = null;
  }

  /** false = belum terhubung; layar harus menyebutnya, bukan diam-diam membuang tombol. */
  send(frame: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.opts.onStatus('perubahan tidak terkirim: tidak terhubung ke server');
      return false;
    }
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  tempo(bpm: number): boolean {
    return this.send({ t: 'tempo', bpm });
  }

  transport(on: boolean): boolean {
    return this.send({ t: on ? 'start' : 'stop' });
  }

  // Setlist (M3b). Klien hanya mengirim niat; batas 20 lagu, panjang judul, dan rentang bpm
  // diperiksa server — layar boleh mematikan tombol, tapi itu kenyamanan, bukan gerbang.
  laguTambah(judul: string, bpm: number): boolean {
    return this.send({ t: 'lagu', op: 'tambah', judul, bpm });
  }

  laguHapus(id: number): boolean {
    return this.send({ t: 'lagu', op: 'hapus', id });
  }

  laguGeser(id: number, naik: boolean): boolean {
    return this.send({ t: 'lagu', op: naik ? 'naik' : 'turun', id });
  }

  laguPilih(id: number): boolean {
    return this.send({ t: 'lagu', op: 'pilih', id });
  }

  /**
   * Rebut kendali (ADR-0005): satu-satunya jalan kembali ke podium sesudah DO berpindah
   * tangan atau ter-evict dengan `did` lama. Tanpa `lk` tidak ada frame yang dikirim —
   * mengirim `claim` kosong cuma menghasilkan `NOT_LEADER` dan membuat layarnya bisu.
   */
  claim(): boolean {
    const lk = this.target.lk;
    if (!lk) {
      this.opts.onStatus('rebut ditolak: HP ini tidak punya kunci pemimpin (hanya yang membuat sesi yang punya)');
      return false;
    }
    return this.send({ t: 'claim', lk });
  }

  /** Umur socket yang sedang terbuka; `Infinity` kalau tidak ada socket. */
  msSinceOpen(): number {
    return this.openedAt ? Date.now() - this.openedAt : Number.POSITIVE_INFINITY;
  }

  thetaMs(): number {
    if (this.samples.length) return estimateOffset(this.samples);
    // Sebelum ada pong, tebakan terbaik adalah selisih jam yang server sendiri beritahu.
    // Nol bukan "belum ada data": HP pertama di lapangan mengukur θ 657 ms, dan klik yang
    // mulai dengan θ = 0 masuk telat lebih dari satu beat.
    return this.seedMs ?? 0;
  }

  /** Berapa milidetik lalu pong terakhir; > 5 s berarti θ yang dipakai klik sudah basi. */
  thetaAgeMs(): number {
    return this.lastPongAt ? Date.now() - this.lastPongAt : Number.POSITIVE_INFINITY;
  }

  sampleCount(): number {
    return this.samples.length;
  }

  /**
   * Satu ping ekstra sekarang, jangan tunggu interval berikutnya: tab yang baru kembali
   * dari latar punya θ setua lama ia tertidur, dan klik sempat menyetel seluruh band
   * ke angka basi itu selama satu detik penuh.
   */
  pingNow(): void {
    this.ping();
  }

  private onMessage(data: string): void {
    // Frame yang sudah antre di socket ketika layar ditutup tidak punya hak lagi:
    // sesudah `close()` tidak ada satu pun jalur yang boleh menyalakan timer klik baru.
    if (this.closedByUser) return;
    let frame: Record<string, unknown>;
    try {
      // Gerbang yang sama dengan frame keluar: socket yang dibajak tidak boleh mengirim
      // 8 MB atau __proto__ ke layar.
      frame = parseFrame(data);
    } catch (e) {
      // Kode, bukan pesan panjang: operator membacanya di layar HP yang kecil.
      this.opts.onStatus(`frame ditolak: ${e instanceof FrameReject ? e.code : String(e)}`);
      return;
    }
    switch (frame.t) {
      case 'welcome': {
        const now = Number(frame.serverNow);
        if (Number.isFinite(now)) {
          this.seedMs = now - Date.now();
          // θ dilaporkan lewat jalur yang sama dengan pong, supaya engine tidak pernah
          // mulai menyetel beat dengan θ = 0 sementara `state` sudah mendarat.
          this.opts.onTheta(this.thetaMs());
        }
        const n = Number(frame.members);
        if (Number.isFinite(n)) this.opts.onMembers(n);
        const wrote = Number(frame.rowsWritten);
        if (wrote > 0) {
          this.opts.onStatus(`masuk sebagai anggota (${wrote} baris ditulis)`);
        }
        return;
      }
      case 'state': {
        // Dibaca sebelum gerbang grid: jumlah HP adalah informasi independen, dan
        // membekukannya hanya karena satu field tempo terlihat cacat adalah persis pola
        // bug yang membuat angka di layar pemimpin berhenti di '1 HP'.
        const n = Number(frame.members);
        if (Number.isFinite(n)) this.opts.onMembers(n);
        // Setlist dibaca sebelum gerbang grid, alasannya sama dengan `members`: daftar lagu
        // adalah informasi yang berdiri sendiri, dan satu field tempo yang mencurigakan tidak
        // boleh membekukan lagu-lagu yang sudah benar-benar dikirim server.
        const songs = parseSetlist(frame.setlist);
        if (songs) this.opts.onSetlist?.(songs, parseSongId(frame.laguAktif));
        const bpm = parseBpm(frame.bpm);
        const anchorMs = frame.anchorMs === null ? null : Number(frame.anchorMs);
        // Server sudah membatasi bpm, tapi kepercayaan tidak diwarisi: `bpm: 0` membuat
        // periodMs Infinity (klik bisu, 0 hilang, tanpa satu pun error) dan periode negatif
        // membuat scheduler berputar tanpa pernah menyentuh horizon — tab membeku.
        const anchorOk =
          anchorMs === null || (Number.isFinite(anchorMs) && Math.abs(anchorMs - Date.now()) <= ANCHOR_SANE_MS);
        if (bpm === null || !anchorOk) {
          this.opts.onStatus('frame state cacat — grid lama tetap dipakai');
          return;
        }
        this.opts.onState({ bpm, anchorMs, running: frame.running === true });
        return;
      }
      case 'pong': {
        const nonce = frame.nonce;
        if (typeof nonce !== 'number') return;
        const timeout = this.pending.get(nonce);
        if (!timeout) return; // telat sesudah dicatat basi: jangan gandakan sampel
        clearTimeout(timeout);
        this.pending.delete(nonce);
        const st: Stamps = {
          t1: Number(frame.t1),
          t2: Number(frame.t2),
          t3: Number(frame.t3),
          t4: Date.now(),
        };
        const sample = toSample(st);
        if (!sample) return;
        this.samples.push(sample);
        if (this.samples.length > SAMPLE_WINDOW) this.samples.splice(0, this.samples.length - SAMPLE_WINDOW);
        this.lastPongAt = Date.now();
        this.opts.onTheta(this.thetaMs());
        return;
      }
      case 'error':
        this.opts.onStatus(`server menolak: ${String(frame.code)}`);
        return;
      default:
        return;
    }
  }

  private ping(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const nonce = this.nonce++;
    const slot = Date.now();
    this.pending.set(
      nonce,
      setTimeout(() => {
        this.pending.delete(nonce);
        this.opts.onStatus(`ping ${nonce} hilang — θ memakai ${this.samples.length} sampel terakhir`);
      }, PING_TIMEOUT_MS)
    );
    ws.send(JSON.stringify({ t: 'ping', nonce, t1: slot }));
  }

  private startPings(): void {
    if (this.timer !== null) return;
    // Satu ping langsung, bukan satu detik lagi: `state` sudah mendarat puluhan milidetik
    // sesudah open, dan klik tidak boleh menunggu sampel pertama untuk punya θ.
    this.ping();
    this.timer = setInterval(() => this.ping(), PING_INTERVAL_MS);
  }

  private stopPings(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}

const DID_KEY = 'paranoidclick.did';
// shortcut: kapabilitas sesi ikut di localStorage, bukan sessionStorage — iOS membuang isi
// sessionStorage saat me-reap tab, dan pemandu yang tabnya mati lalu membuka aplikasi lagi
// tidak punya jalan kembali ke sid-nya sendiri; `/create` selalu melahirkan sid baru.
// Bayarnya: `tok` — dan sejak M3a `lk` pemimpin — bertahan sampai sesi berikutnya diganti.
// Kedaluwarsa token: M3.
const SESSION_KEY = 'paranoidclick.session';

export interface Remembered extends LiveTarget {
  /** HP yang membuat sesi kemarin harus masuk lagi dengan tombol pemimpin aktif. */
  leader: boolean;
}

export function rememberTarget(t: LiveTarget, leader: boolean): void {
  try {
    // `lk` ikut — TANPA itu jalan "Lanjut ke sesi" hanya mengembalikan kendali kalau kunci
    // pemimpin ikut tersimpan. Tidak pernah lewat URL, jadi localStorage satu-satunya tempat
    // ia boleh tinggal di HP pemimpin.
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ sid: t.sid, tok: t.tok, ...(t.lk ? { lk: t.lk } : {}), leader })
    );
  } catch {
    // Mode privat / storage diblokir: tidak ada jalan.resume, tapi klik tetap jalan.
  }
}

export function readRemembered(): Remembered | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Remembered>;
    if (!isSid(v.sid) || typeof v.tok !== 'string' || !TOKEN_RE.test(v.tok)) return null;
    // Kunci yang tersimpan ikut divalidasi dengan pola yang sama: localStorage adalah input
    // pengguna (siapa pun yang bisa membuka DevTools), bukan penyimpanan aman.
    const lk = typeof v.lk === 'string' && TOKEN_RE.test(v.lk) ? v.lk : undefined;
    return { sid: v.sid, tok: v.tok, ...(lk ? { lk } : {}), leader: v.leader === true };
  } catch {
    return null;
  }
}

function readDid(): string {
  try {
    const saved = localStorage.getItem(DID_KEY);
    if (saved && /^[0-9a-f]{16}$/.test(saved)) return saved;
    const fresh = genDid();
    localStorage.setItem(DID_KEY, fresh);
    return fresh;
  } catch {
    // Mode privat / storage diblokir: identitas sementara lebih baik daripada klik bisu.
    return genDid();
  }
}
