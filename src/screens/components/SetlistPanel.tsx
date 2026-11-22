import { useEffect, useRef, useState, type FC } from 'react';
import { MAX_BPM, MIN_BPM, parseBpm } from '../../shared/tempo';
import { MAX_JUDUL, MAX_SETLIST, type Song } from '../../shared/setlist';
import { formatDuration, trackForSong, type TrackMeta } from '../../app/media/trackStore';

export interface SetlistPanelProps {
  songs: Song[];
  aktif: number | null;
  bpmSekarang: number;
  bolehUbah: boolean;
  tracks: TrackMeta[];
  onTambah: (judul: string, bpm: number) => void;
  onHapus: (id: number) => void;
  onGeser: (id: number, naik: boolean) => void;
  onPilih: (id: number) => void;
}

/**
 * Tab 2: setlist server + lembar panggung. Data lagu yang disiarkan server hanya
 * `id/judul/bpm`; tuning, key, catatan, dan penanda backing datang dari track lokal
 * yang dicocokkan lewat id atau judul.
 */
export const SetlistPanel: FC<SetlistPanelProps> = ({
  songs,
  aktif,
  bpmSekarang,
  bolehUbah,
  tracks,
  onTambah,
  onHapus,
  onGeser,
  onPilih,
}) => {
  const [judul, setJudul] = useState('');
  const [bpm, setBpm] = useState('');
  const [stageId, setStageId] = useState<number | null>(null);
  const [font, setFont] = useState(20);
  const [autoScroll, setAutoScroll] = useState(false);
  const stageBody = useRef<HTMLDivElement | null>(null);
  const penuh = songs.length >= MAX_SETLIST;

  const stageSong = songs.find((s) => s.id === stageId) ?? null;
  const stageIndex = stageSong ? songs.findIndex((s) => s.id === stageSong.id) : -1;
  const stageTrack = stageSong ? trackForSong(tracks, stageSong.id, stageSong.judul) : undefined;
  const upNext = stageIndex >= 0 ? songs[stageIndex + 1] ?? null : null;

  useEffect(() => {
    if (stageId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStageId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stageId]);

  useEffect(() => {
    if (!autoScroll || stageId === null) return;
    const id = window.setInterval(() => {
      const el = stageBody.current;
      if (!el) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) el.scrollTop = 0;
      else el.scrollTop += 1;
    }, 50);
    return () => window.clearInterval(id);
  }, [autoScroll, stageId]);

  const tambah = () => {
    const nama = judul.trim();
    const nilai = parseBpm(Number(bpm.trim() === '' ? bpmSekarang : bpm));
    if (!bolehUbah || penuh || nama.length === 0 || nilai === null) return;
    onTambah(nama, nilai);
    setJudul('');
    setBpm('');
  };

  const pindah = (index: number) => {
    const song = songs[index];
    if (!song) return;
    setStageId(song.id);
    if (bolehUbah) onPilih(song.id);
  };

  const totalMs = songs.reduce((sum, song) => {
    const track = trackForSong(tracks, song.id, song.judul);
    return sum + (track?.durationMs ?? 0);
  }, 0);
  const jumlahTrack = songs.filter((song) => trackForSong(tracks, song.id, song.judul)).length;

  return (
    <section className="panel setlist-panel" aria-label="Setlist">
      <div className="setlist-head">
        <div>
          <p className="panel-kicker">SETLIST</p>
          <h2 className="panel-title">
            {songs.length} / {MAX_SETLIST} Lagu
          </h2>
        </div>
        <div className="setlist-total">
          <span className="muted">Total durasi</span>
          <b>{jumlahTrack > 0 ? formatDuration(totalMs) : '—'}</b>
          <span className="muted">{jumlahTrack > 0 ? `${jumlahTrack} track lokal` : 'belum ada track'}</span>
        </div>
      </div>

      {songs.length === 0 ? (
        <p className="empty">
          Belum ada lagu. {bolehUbah ? 'Tambahkan lagu pertama di bawah.' : 'Pemimpin belum menambahkan lagu.'}
        </p>
      ) : (
        <ol className="song-list">
          {songs.map((song, i) => {
            const track = trackForSong(tracks, song.id, song.judul);
            const note = track?.notes.split('\n').find((line) => line.trim());
            return (
              <li key={song.id} className={`song-card${song.id === aktif ? ' aktif' : ''}`}>
                <button type="button" className="song-open" onClick={() => setStageId(song.id)} aria-label={`Buka lembar ${song.judul}`}>
                  <span className="song-no">{song.id === aktif ? '▶' : String(i + 1).padStart(2, '0')}</span>
                  <span className="song-body">
                    <span className="song-title">{song.judul}</span>
                    <span className="song-meta">
                      <span className="tag">{song.bpm} BPM</span>
                      <span className="tag">{track?.tuning || '—'}</span>
                      <span className="tag">{track?.key || '—'}</span>
                      {track && <span className="tag bt">BT</span>}
                    </span>
                    {note && <span className="song-note">{note}</span>}
                  </span>
                </button>
                {bolehUbah && (
                  <div className="song-actions">
                    <button type="button" className="icon-btn" onClick={() => onGeser(song.id, true)} disabled={i === 0} aria-label={`Naikkan ${song.judul}`}>
                      ↑
                    </button>
                    <button type="button" className="icon-btn" onClick={() => onGeser(song.id, false)} disabled={i === songs.length - 1} aria-label={`Turunkan ${song.judul}`}>
                      ↓
                    </button>
                    <button type="button" className="sync-song" onClick={() => onPilih(song.id)}>
                      PILIH & SYNC
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => onHapus(song.id)} aria-label={`Hapus ${song.judul}`}>
                      ×
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {bolehUbah && (
        <div className="add-song">
          <p className="panel-kicker">+ TAMBAH LAGU</p>
          <div className="add-song-row">
            <input
              className="input"
              value={judul}
              maxLength={MAX_JUDUL}
              placeholder="Judul lagu"
              onChange={(e) => setJudul(e.currentTarget.value)}
              aria-label="Judul lagu baru"
            />
            <input
              className="input bpm-input"
              value={bpm}
              inputMode="numeric"
              placeholder={String(bpmSekarang)}
              onChange={(e) => setBpm(e.currentTarget.value)}
              aria-label={`BPM lagu baru (${MIN_BPM}–${MAX_BPM})`}
            />
            <button type="button" className="btn btn-primary" onClick={tambah} disabled={penuh}>
              Tambah
            </button>
          </div>
          {penuh && <p className="small">Batas {MAX_SETLIST} lagu tercapai — hapus satu untuk menambah yang lain.</p>}
        </div>
      )}

      {stageSong && (
        <div className="stage-sheet" role="dialog" aria-modal="true" aria-label={`Lembar panggung ${stageSong.judul}`}>
          <header className="stage-head">
            <div className="stage-head-text">
              <p className="panel-kicker">LEMBAR PANGGUNG · {stageIndex + 1}/{songs.length}</p>
              <h2 className="stage-title">{stageSong.judul}</h2>
              <p className="stage-meta">
                {stageSong.bpm} BPM · {stageTrack?.tuning || '—'} · {stageTrack?.key || '—'}
                {stageTrack ? ' · backing tersedia' : ''}
              </p>
            </div>
            <button type="button" className="icon-btn" onClick={() => setStageId(null)} aria-label="Tutup lembar panggung" autoFocus>
              ×
            </button>
          </header>

          <div className="stage-tools">
            <button type="button" className="tool-btn" onClick={() => setFont((n) => Math.max(14, n - 2))} aria-label="Perkecil teks">
              A-
            </button>
            <button type="button" className="tool-btn" onClick={() => setFont((n) => Math.min(40, n + 2))} aria-label="Perbesar teks">
              A+
            </button>
            <button type="button" className={`tool-btn${autoScroll ? ' on' : ''}`} onClick={() => setAutoScroll((v) => !v)} aria-pressed={autoScroll}>
              Auto-scroll
            </button>
            <span className="muted stage-font">{font}px</span>
          </div>

          <div ref={stageBody} className="stage-body" style={{ fontSize: font }}>
            {stageTrack?.notes ? (
              stageTrack.notes.split('\n').map((line, i) => (
                <p key={i} className={line.trim() ? 'stage-line' : 'stage-gap'}>
                  {line}
                </p>
              ))
            ) : (
              <p className="empty">
                Belum ada lirik atau catatan panggung untuk lagu ini. Tambahkan di tab Tracks & MIDI,
                lalu hubungkan track ke lagu ini.
              </p>
            )}
          </div>

          <footer className="stage-foot">
            <button type="button" className="btn btn-secondary" onClick={() => pindah(stageIndex - 1)} disabled={stageIndex <= 0}>
              ‹ Sebelumnya
            </button>
            <div className="upnext">
              <span className="panel-kicker">UP NEXT</span>
              <b>{upNext ? upNext.judul : '— akhir setlist —'}</b>
              {upNext && <span className="muted">{upNext.bpm} BPM</span>}
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => pindah(stageIndex + 1)} disabled={stageIndex >= songs.length - 1}>
              Berikutnya ›
            </button>
          </footer>
        </div>
      )}
    </section>
  );
};
