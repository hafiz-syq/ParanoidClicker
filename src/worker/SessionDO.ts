import { DurableObject } from 'cloudflare:workers';
import { FrameReject, MAX_MEMBERS, parseFrame } from '../shared/limits';
import { isSid } from '../shared/ids';
import { verifyLeaderKey } from './keys';
import { DEFAULT_BPM, LEAD_MS, gridOf, parseBpm, retune, type Grid } from '../shared/tempo';
import { MAX_SETLIST, parseJudul, parseSongId, type Song } from '../shared/setlist';

/** Keadaan sesi yang sebenarnya: satu grid klik, bukan daftar "tick yang sudah dikirim". */
interface TempoState {
  bpm: number;
  anchorMs: number | null;
  running: boolean;
}

/**
 * Identitas hasil `hello` yang berhasil, per socket — plus satu fakta yang TIDAK bisa dikarang
 * dari frame: `lkDibuktikan`. Sejak S8-b (jawaban pemilik `2026-11-16T23:06:05.165Z`) kecocokan
 * `did` saja bukan otoritas; yang boleh memerintah cuma socket yang verifikasi `lk`-nya lulus,
 * dan hasil verifikasi itu ikut tersimpan di attachment socket (ADR-0007) sehingga bertahan
 * ketika DO tidur dan dibangun ulang.
 */
interface Peer {
  sid: string;
  did: string;
  lkDibuktikan: boolean;
}

export class SessionDO extends DurableObject<Env> {
  // Pola resmi Cloudflare: this.sql = ctx.storage.sql (basis data SQLite, bukan KV).
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS member (did TEXT PRIMARY KEY, joined_at INTEGER NOT NULL)');
    // CHECK(id = 1) memaksa satu baris: keadaan tempo tidak boleh bercabang jadi dua sejarah.
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS tempo (id INTEGER PRIMARY KEY CHECK (id = 1), bpm INTEGER NOT NULL, anchor_ms INTEGER NOT NULL, running INTEGER NOT NULL)'
    );
    // Baris tunggal yang sama untuk podium: `lk` adalah kapabilitas, dan satu ruangan cuma
    // boleh punya satu pemimpin. `lk_hint` = 8 hex pertama — cukup untuk membuktikan rebut
    // yang misterius memakai kunci mana, tidak cukup untuk merebut apa pun.
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS leader (id INTEGER PRIMARY KEY CHECK (id = 1), did TEXT NOT NULL, lk_hint TEXT, claimed_at INTEGER NOT NULL)'
    );
    // Setlist (M3b): satu baris per lagu, urutannya kolom sendiri — bukan id — supaya "naik"
    // dan "turun" cukup menukar dua angka tanpa menyentuh kunci baris. `bpm` dibatasi
    // `parseBpm` di jalur tulis, jadi tidak ada lagu yang lahir dengan tempo di luar 30..300.
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS song (id INTEGER PRIMARY KEY AUTOINCREMENT, judul TEXT NOT NULL, bpm INTEGER NOT NULL, urutan INTEGER NOT NULL)'
    );
    // Pola baris tunggal yang sama dengan `tempo`/`leader`: satu ruangan cuma punya satu lagu
    // aktif. NULL = belum ada lagu yang dipilih, dan itu bukan keadaan yang salah.
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS lagu_aktif (id INTEGER PRIMARY KEY CHECK (id = 1), song_id INTEGER)'
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      ws.close(1003, 'spike accepts text frames only');
      return;
    }

    let frame: Record<string, unknown>;
    try {
      frame = parseFrame(message);
    } catch (e) {
      ws.send(JSON.stringify({ t: 'error', code: e instanceof FrameReject ? e.code : 'INTERNAL' }));
      return;
    }

    switch (frame.t) {
      case 'hello':
        return this.hello(ws, frame);
      case 'ping':
        return this.pong(ws, frame);
      case 'claim':
        return this.claim(ws, frame);
      case 'tempo':
        return this.setTempo(ws, frame);
      case 'start':
        return this.transport(ws, true);
      case 'stop':
        return this.transport(ws, false);
      case 'lagu':
        return this.lagu(ws, frame);
      default:
        ws.send(JSON.stringify({ t: 'error', code: 'PROTO' }));
    }
  }

  /**
   * Identitas hasil `hello`, per socket — dibaca dari attachment Hibernation, BUKAN dari memori
   * DO. `did` tidak pernah diambil dari frame perintah: isinya bisa dikarang siapa pun yang punya
   * socket sesi, dan justru itulah yang ditutup M3a.
   *
   * Tempat ini pernah `Map<WebSocket, Peer>` milik instance. Map itu hilang ketika DO tidur —
   * `fetch()` memakai `ctx.acceptWebSocket` (Hibernation API) dan runtime membangun ulang DO
   * dengan objek WebSocket baru — jadi pemimpin sah dijawab NOT_LEADER, bahkan lewat `claim`
   * ber-`lk` yang sah: tombol "Ambil kendali" menjadi jalur buntu sampai pengguna me-reload.
   * Attachment ikut tersimpan dan dipulihkan runtime, jadi kebenaran cuma ada satu tempat.
   */
  private peerOf(ws: WebSocket): Peer | undefined {
    // fakeSocket di session.spec.ts cuma meniru kirim/close, jadi metodenya diuji ada; tanpa
    // penjaga ini socket palsu melempar TypeError, bukan dijawab "belum dikenal".
    const tersimpan = typeof ws.deserializeAttachment === 'function' ? ws.deserializeAttachment() : null;
    if (!tersimpan || typeof tersimpan.sid !== 'string' || typeof tersimpan.did !== 'string') return undefined;
    // Gagal tertutup: attachment tanpa flag — atau dengan nilai apa pun selain `true` — berarti
    // socket ini tidak pernah membuktikan `lk`. Yang disimpan cuma HASIL verifikasi (boolean),
    // tidak pernah kuncinya, jadi attachment tetap puluhan byte (ADR-0007 §batas).
    return { sid: tersimpan.sid, did: tersimpan.did, lkDibuktikan: tersimpan.lkDibuktikan === true };
  }

  private remember(ws: WebSocket, peer: Peer): void {
    if (typeof ws.serializeAttachment === 'function') ws.serializeAttachment(peer);
  }

  // Satu-satunya jalur tulis SQLite di spike ini: transisi keanggotaan, bukan heartbeat.
  // (Tabel `leader` juga ditulis, tapi hanya saat hello/claim — peristiwa yang sama jarangnya.)
  private async hello(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const did = typeof frame.did === 'string' ? frame.did : '';
    const sid = typeof frame.sid === 'string' ? frame.sid : '';
    const lk = typeof frame.lk === 'string' ? frame.lk : '';
    if (!isSid(sid) || did.length === 0 || did.length > 32) {
      ws.send(JSON.stringify({ t: 'error', code: 'PROTO' }));
      return;
    }
    // Dibaca dari tabel, bukan dari memori: DO boleh dievict kapan saja dan dibangun ulang.
    // Generik <{n:number}> wajib: tanpa itu .one() bertipe SqlStorageValue (boleh null).
    // Yang tersisa dari tabel `member` cuma ini — jumlah KURSI sudah pindah ke socket hidup.
    const terdaftar = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM member WHERE did = ?', did).one().n > 0;
    // Socket mentah: yang buka koneksi lalu tidak pernah hello pun sudah memakan satu kursi,
    // dan ia ikut menghitung dirinya sendiri (karenanya `total + 1` yang lama hilang).
    const kursi = this.seatCount();
    if (!terdaftar && kursi > MAX_MEMBERS) {
      ws.send(JSON.stringify({ t: 'error', code: 'FULL' }));
      return;
    }
    // Socket ini dihitung "baru" kalau DO belum pernah melihat hello darinya — attachment socket
    // yang sama bertahan lintas hibernasi, jadi reconnect setelah DO tidur tidak dihitung baru.
    // Yang berpindah rute (socket baru, `did` lama) tetap dihitung baru dan ikut menyiarkan.
    const baru = this.peerOf(ws) === undefined;
    // Verifikasi terjadi di sini, sebelum hasilnya bisa dibaca siapa pun, dan yang menempel di
    // socket adalah HASILNYA (boolean), bukan kuncinya. `hello` tanpa `lk` menghasilkan `false` —
    // termasuk di socket yang dulu sudah mengikat podium, jadi HP yang kehilangan `lk` di
    // localStorage harus `claim` lagi untuk boleh memerintah. Perubahan perilaku itu disengaja
    // (ADR-0005, S8-b) dan wajib disebut di README, bukan diselipkan.
    const lkDibuktikan = lk.length > 0 && (await verifyLeaderKey(sid, lk, this.env));
    this.remember(ws, { sid, did, lkDibuktikan });
    // OR IGNORE, bukan OR REPLACE: hello ulang dari HP yang sama tidak boleh membayar
    // kuota "rows written" dua kali dan tidak boleh menggeser joined_at aslinya.
    const cursor = this.sql.exec(
      'INSERT OR IGNORE INTO member (did, joined_at) VALUES (?, ?)',
      did,
      Date.now()
    );
    // `lk` diverifikasi tiap hello, bukan dipercaya dari hasil sebelumnya. Flag di atas tetap
    // ter-set ketika podium sudah dipegang `did` lain — reconnect pemimpin sah tidak boleh
    // kehilangan bukti kriptonya cuma karena podium sedang pindah (S8-b butir 5). Yang mengikat
    // podium tetap SATU kali: sesudah terisi, jalurnya adalah rebut eksplisit lewat `claim`.
    // reconnect pemimpin TIDAK menulis ulang — `claimed_at` tetap jam podium benar-benar direbut,
    // dan hello ulang tidak membayar kuota tulis lagi (yang diperbarui cuma attachment socketnya).
    if (lkDibuktikan && this.leaderDid() === null) {
      this.bindLeader(did, lk);
    }
    ws.send(
      JSON.stringify({
        t: 'welcome',
        sid,
        did,
        serverNow: Date.now(),
        members: kursi,
        rowsWritten: cursor.rowsWritten,
      })
    );
    // Yang baru masuk harus langsung sephase, bukan menunggu perubahan tempo berikutnya.
    const teks = this.stateFrame(this.readTempo());
    ws.send(teks);
    // Nomor orang lain juga harus tahu ada yang baru, TAPI hanya kalau kursinya benar-benar
    // bergerak: hello ulang di socket yang sama (tab bangun dari latar) tidak boleh mengirim
    // dua belas frame ke ruangan yang sedang menghitung beat.
    if (baru || cursor.rowsWritten > 0) this.sendToRoom(teks, ws);
  }

  /**
   * Kursi = socket yang masih OPEN di DO ini. ANGKA MENTAH, tanpa deduplikasi `did`:
   * satu HP yang jaringan-nya flap atau reload sebelum socket lama terdeteksi tutup memakan
   * dua kursi, jadi ruangan 12 bisa menjawab FULL dengan 11 HP nyata. Itu konsekuensi yang
   * dipilih (§4 butir 2b) dan masih [TANYA] untuk diubah jadi hitungan per `did`.
   */
  private seatCount(): number {
    let n = 0;
    for (const peer of this.ctx.getWebSockets()) {
      if (peer.readyState === WebSocket.OPEN) n++;
    }
    return n;
  }

  /** `did` yang sedang memegang podium, atau null kalau belum ada kunci yang mengikat. */
  private leaderDid(): string | null {
    const row = this.sql.exec<{ did: string }>('SELECT did FROM leader WHERE id = 1').toArray()[0];
    return row ? row.did : null;
  }

  private bindLeader(did: string, lk: string): void {
    this.sql.exec(
      `INSERT INTO leader (id, did, lk_hint, claimed_at) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET did = excluded.did, lk_hint = excluded.lk_hint, claimed_at = excluded.claimed_at`,
      did,
      lk.slice(0, 8),
      Date.now()
    );
  }

  /**
   * Gagal tertutup: tanpa baris `leader` — sesi yang belum pernah menyambut HP berkunci —
   * TIDAK ada yang boleh memerintah. Bukan "siapa saja sampai ada yang klaim": §3 menolak
   * otoritas tanpa kunci. Kunci identitas diambil dari socket, bukan dari frame.
   *
   * Dua syarat, dan keduanya menempel di SOCKET yang sama (S8-b): bukti kripto `lk` pernah
   * lulus di socket ini DAN `did`-nya adalah pemegang podium. `did` yang cocok tanpa flag bukan
   * otoritas — string itu datang dari frame klien dan server cuma menjaga panjangnya.
   */
  private assertLeader(ws: WebSocket): boolean {
    const peer = this.peerOf(ws);
    if (peer && peer.lkDibuktikan && this.leaderDid() === peer.did) return true;
    ws.send(JSON.stringify({ t: 'error', code: 'NOT_LEADER' }));
    return false;
  }

  /**
   * Rebut kendali (ADR-0005): `lk` diverifikasi ULANG dari frame ini, hasil `hello` tidak
   * dipercaya. Yang tidak membawa kunci dijawab `NOT_LEADER` dan ruangan tidak melihat apa pun.
   */
  private async claim(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const peer = this.peerOf(ws);
    const lk = typeof frame.lk === 'string' ? frame.lk : '';
    if (!peer || !lk || !(await verifyLeaderKey(peer.sid, lk, this.env))) {
      ws.send(JSON.stringify({ t: 'error', code: 'NOT_LEADER' }));
      return;
    }
    this.remember(ws, { sid: peer.sid, did: peer.did, lkDibuktikan: true });
    this.bindLeader(peer.did, lk);
    this.broadcast(this.readTempo());
  }

  // Dibaca dari tabel, bukan dari memori: DO boleh dievict di tengah lagu dan dibangun ulang
  // dengan tempo yang sama — alasan yang sama dengan hitungan member di hello().
  private readTempo(): TempoState {
    const row = this.sql
      .exec<{ bpm: number; anchor_ms: number; running: number }>('SELECT bpm, anchor_ms, running FROM tempo WHERE id = 1')
      .toArray()[0];
    if (!row) return { bpm: DEFAULT_BPM, anchorMs: null, running: false };
    return { bpm: row.bpm, anchorMs: row.running === 1 ? row.anchor_ms : null, running: row.running === 1 };
  }

  private writeTempo(state: TempoState): void {
    this.sql.exec(
      `INSERT INTO tempo (id, bpm, anchor_ms, running) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET bpm = excluded.bpm, anchor_ms = excluded.anchor_ms, running = excluded.running`,
      state.bpm,
      state.anchorMs ?? 0,
      state.running ? 1 : 0
    );
  }

  private gridOf(state: TempoState): Grid | null {
    return state.running && state.anchorMs !== null ? gridOf(state.bpm, state.anchorMs) : null;
  }

  private stateFrame(state: TempoState): string {
    // `members` ikut di frame ini, bukan cuma di welcome: HP yang sudah duduk di ruangan
    // tidak pernah hello ulang selama lagu berjalan, jadi frame inilah satu-satunya jalan
    // 'N HP' di layar pemimpin bisa naik — dan sejak §6.2 juga satu-satunya jalan angka itu
    // TURUN. Angkanya adalah kursi (socket OPEN), bukan riwayat: HP yang ditolak FULL pun sudah
    // memegang satu socket, jadi ia ikut terhitung di siaran BERIKUTNYA (penolakannya sendiri
    // tidak menyiarkan apa pun). Itu konsekuensi socket mentah yang sama dengan di seatCount().
    // `setlist` ikut di setiap state (bukan frame sendiri) supaya satu frame tetap satu
    // kebenaran: HP yang baru masuk, HP yang reconnect sesudah DO tidur, dan HP yang melihat
    // lagu dipilih semuanya membaca daftar dari tempat yang sama. Kedalamannya tepat di batas
    // MAX_JSON_DEPTH (frame → array → lagu → nilai), jadi menambah satu tingkat sarang di sini
    // akan ditolak `checkShape` di klien.
    return JSON.stringify({
      t: 'state',
      bpm: state.bpm,
      anchorMs: state.anchorMs,
      running: state.running,
      members: this.seatCount(),
      setlist: this.readSetlist(),
      laguAktif: this.readAktif(),
    });
  }

  private broadcast(state: TempoState): void {
    this.sendToRoom(this.stateFrame(state));
  }

  // Satu loop untuk semua siaran, supaya frame yang disiarkan karena orang baru masuk
  // benar-benar teks yang sama — dua HP dengan dua versi teks = dua versi kebenaran.
  private sendToRoom(text: string, kecuali?: WebSocket): void {
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== kecuali && peer.readyState === WebSocket.OPEN) peer.send(text);
    }
  }

  private apply(from: TempoState, to: TempoState): void {
    if (from.bpm === to.bpm && from.running === to.running && from.anchorMs === to.anchorMs) return;
    this.writeTempo(to);
    this.broadcast(to);
  }

  /**
   * Otoritas pemimpin dijaga di sini sejak M3a (`assertLeader`). Urutan penjaga bukan detail:
   * bpm diperiksa lebih dulu supaya frame cacat tetap dijawab `BAD_BPM` (tes 'tempo cacat'
   * mengirimnya dari socket yang bukan pemimpin), dan `NOT_LEADER` tidak pernah menyentuh
   * keadaan ruangan.
   */
  private setTempo(ws: WebSocket, frame: Record<string, unknown>): void {
    const bpm = parseBpm(frame.bpm);
    if (bpm === null) {
      // Ditolak ke pengirim saja: satu frame cacat tidak boleh mengubah keadaan sebelas HP.
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_BPM' }));
      return;
    }
    if (!this.assertLeader(ws)) return;
    const cur = this.readTempo();
    this.apply(cur, this.retuned(cur, bpm));
  }

  // Satu jalur ganti tempo, dipakai `tempo` dan `pilih` lagu: lagu yang dipilih menggerakkan
  // grid lewat jahitan yang sama (ADR-0002), bukan lewat jalur kedua yang bisa berbeda.
  private retuned(cur: TempoState, bpm: number): TempoState {
    if (cur.bpm === bpm) return cur;
    const grid = this.gridOf(cur);
    const at = Date.now() + LEAD_MS;
    return grid ? { bpm, anchorMs: retune(grid, bpm, at).anchorMs, running: true } : { bpm, anchorMs: null, running: false };
  }

  /**
   * Setlist (M3b). Otoritasnya sama persis dengan `tempo`: satu kemampuan, satu kunci — semua
   * jalur tulis lewat `assertLeader`, dan tidak satu pun perintah di sini membawa `lk`/`did`.
   * Balasannya bukan frame baru, melainkan `state` yang sudah ada, jadi klien lama yang tidak
   * mengenal `setlist` tetap memahami setiap byte lain di frame itu.
   */
  private lagu(ws: WebSocket, frame: Record<string, unknown>): void {
    if (!this.assertLeader(ws)) return;
    switch (frame.op) {
      case 'tambah':
        return this.laguTambah(ws, frame);
      case 'hapus':
        return this.laguHapus(ws, frame);
      case 'naik':
        return this.laguGeser(ws, frame, -1);
      case 'turun':
        return this.laguGeser(ws, frame, 1);
      case 'pilih':
        return this.laguPilih(ws, frame);
      default:
        ws.send(JSON.stringify({ t: 'error', code: 'PROTO' }));
    }
  }

  private laguTambah(ws: WebSocket, frame: Record<string, unknown>): void {
    const judul = parseJudul(frame.judul);
    const bpm = parseBpm(frame.bpm);
    if (judul === null || bpm === null) {
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_SONG' }));
      return;
    }
    // Satu query untuk dua angka yang dibutuhkan sekaligus: kalau daftar dibaca utuh (lalu
    // dipetakan ke `Song`) hanya untuk menghitung panjangnya, tiap tambah lagu membangun 20
    // objek yang tidak pernah dikirim.
    const { n, urutan } = this.sql
      .exec<{ n: number; urutan: number }>('SELECT COUNT(*) AS n, COALESCE(MAX(urutan), 0) + 1 AS urutan FROM song')
      .one();
    if (n >= MAX_SETLIST) {
      ws.send(JSON.stringify({ t: 'error', code: 'FULL_SETLIST' }));
      return;
    }
    this.sql.exec('INSERT INTO song (judul, bpm, urutan) VALUES (?, ?, ?)', judul, bpm, urutan);
    this.broadcast(this.readTempo());
  }

  private laguHapus(ws: WebSocket, frame: Record<string, unknown>): void {
    const id = parseSongId(frame.id);
    if (id === null) {
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_SONG' }));
      return;
    }
    const cursor = this.sql.exec('DELETE FROM song WHERE id = ?', id);
    // Tidak ada baris terhapus = tidak ada yang berubah, jadi tidak ada yang perlu disiarkan:
    // dua belas HP tidak dibangunkan untuk perintah yang tidak melakukan apa pun.
    if (cursor.rowsWritten === 0) return;
    if (this.readAktif() === id) this.setAktif(null);
    this.broadcast(this.readTempo());
  }

  /** Geser satu langkah; `delta` −1 = naik. Menukar `urutan` dua baris, bukan menomori ulang. */
  private laguGeser(ws: WebSocket, frame: Record<string, unknown>, delta: number): void {
    const id = parseSongId(frame.id);
    if (id === null) {
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_SONG' }));
      return;
    }
    const songs = this.sql.exec<{ id: number; urutan: number }>('SELECT id, urutan FROM song ORDER BY urutan, id').toArray();
    const i = songs.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= songs.length) return; // sudah di ujung: tidak ada yang berubah
    this.sql.exec('UPDATE song SET urutan = ? WHERE id = ?', songs[j]!.urutan, songs[i]!.id);
    this.sql.exec('UPDATE song SET urutan = ? WHERE id = ?', songs[i]!.urutan, songs[j]!.id);
    this.broadcast(this.readTempo());
  }

  /** Pilih lagu = pilih nada dasar latihan: tempo ruangan pindah ke bpm lagu itu. */
  private laguPilih(ws: WebSocket, frame: Record<string, unknown>): void {
    const id = parseSongId(frame.id);
    if (id === null) {
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_SONG' }));
      return;
    }
    const song = this.sql.exec<{ bpm: number }>('SELECT bpm FROM song WHERE id = ?', id).toArray()[0];
    if (!song) {
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_SONG' }));
      return;
    }
    this.setAktif(id);
    const cur = this.readTempo();
    const next = this.retuned(cur, song.bpm);
    if (next !== cur) this.writeTempo(next);
    // Siaran tetap, walau bpm-nya kebetulan sama: yang berubah adalah lagu aktifnya.
    this.broadcast(next);
  }

  private readSetlist(): Song[] {
    // Baris SQL dipetakan ke `Song` secara eksplisit: tipe generik `exec()` menuntut record
    // ber-index-signature, dan yang dikirim ke HP harus tepat tiga field ini, bukan apa pun
    // yang kebetulan ada di baris tabel.
    return this.sql
      .exec<{ id: number; judul: string; bpm: number }>('SELECT id, judul, bpm FROM song ORDER BY urutan, id')
      .toArray()
      .map((row) => ({ id: row.id, judul: row.judul, bpm: row.bpm }));
  }

  private readAktif(): number | null {
    const row = this.sql.exec<{ song_id: number | null }>('SELECT song_id FROM lagu_aktif WHERE id = 1').toArray()[0];
    return row && typeof row.song_id === 'number' ? row.song_id : null;
  }

  private setAktif(id: number | null): void {
    this.sql.exec(
      `INSERT INTO lagu_aktif (id, song_id) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET song_id = excluded.song_id`,
      id
    );
  }

  private transport(ws: WebSocket, on: boolean): void {
    if (!this.assertLeader(ws)) return;
    const cur = this.readTempo();
    if (on) {
      // Start ulang tidak boleh menggeser downbeat yang sudah jalan: anchor dihitung dari jam,
      // jadi tanpa penjaga ini tombol yang ditekan dua kali membuat semua HP melompat.
      if (cur.running) return;
      // Beat 0 jatuh LEAD_MS dari sekarang, jadi klik pertama serentak walau frame-nya
      // lewat jalan yang berbeda-beda.
      this.apply(cur, { bpm: cur.bpm, anchorMs: Date.now() + LEAD_MS, running: true });
      return;
    }
    this.apply(cur, { bpm: cur.bpm, anchorMs: null, running: false });
  }

  private pong(ws: WebSocket, frame: Record<string, unknown>): void {
    if (typeof frame.nonce !== 'number' || typeof frame.t1 !== 'number') {
      ws.send(JSON.stringify({ t: 'error', code: 'PROTO' }));
      return;
    }
    const t2 = Date.now();
    ws.send(JSON.stringify({ t: 'pong', nonce: frame.nonce, t1: frame.t1, t2, t3: Date.now() }));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Tidak ada keadaan per-socket yang perlu dibersihkan di sini: identitas hidup di attachment
    // socketnya sendiri, dan socket yang tertutup tidak mengembalikan diri ke getWebSockets().
    // Klien bisa mengirim code 1005/1006/1015; ws.close() menolak ketiganya dengan
    // InvalidAccessError, jadi code di luar daftar sah diterjemahkan ke 1000.
    const legal = code >= 1000 && code <= 1011 && code !== 1004 && code !== 1005 && code !== 1006;
    ws.close(legal ? code : 1000, 'client closed');
    // Siaran, bukan diam: `members` sekarang dihitung dari socket yang masih OPEN, dan
    // sesudah close() socket ini tidak OPEN lagi — jadi frame yang lahir di baris berikutnya
    // sudah membawa kursi yang lepas. Tanpa siaran ini, 'N HP' baru turun ketika ada orang
    // mengubah tempo, dan hari itu pemimpin sedang tidak mengubah apa-apa (§4 butir 2c).
    this.broadcast(this.readTempo());
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('websocket error', error);
    ws.close(1011, 'internal');
  }
}
