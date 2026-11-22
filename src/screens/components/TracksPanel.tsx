import { useRef, useState, type ChangeEvent, type FC } from 'react';
import { CHANNELS, type MixChannel, type MixState } from '../../app/media/mixer';
import { formatDuration, type TrackMeta } from '../../app/media/trackStore';
import type { MidiState } from '../../app/midi/midiController';
import type { Song } from '../../shared/setlist';

export interface AudioDevice {
  id: string;
  label: string;
}

export interface TracksPanelProps {
  songs: Song[];
  tracks: TrackMeta[];
  playingId: string | null;
  mix: MixState;
  playHere: boolean;
  midi: MidiState;
  midiIn: string;
  midiOut: string;
  outputs: AudioDevice[];
  message: string | null;
  onMix: (next: MixState) => void;
  onPlayHere: (on: boolean) => void;
  onImport: (files: FileList) => void;
  onDelete: (id: string) => void;
  onMeta: (id: string, patch: Partial<TrackMeta>) => void;
  onPlay: (id: string) => void;
  onStop: () => void;
  onMidiInit: () => void;
  onMidiIn: (id: string) => void;
  onMidiOut: (id: string) => void;
  onOutput: (id: string) => void;
}

const LABEL: Record<MixChannel, string> = { click: 'Click', countIn: 'Count-In', backing: 'Backing' };

/**
 * Tab 3: pustaka track lokal, mixer tiga kanal, dan Web MIDI.
 *
 * Semua kontrol di sini lokal untuk HP ini — volume, panning, dan Program Change tidak
 * disiarkan ke band. Yang disiarkan tetap hanya frame yang sudah ada di kontrak wire.
 */
export const TracksPanel: FC<TracksPanelProps> = ({
  songs,
  tracks,
  playingId,
  mix,
  playHere,
  midi,
  midiIn,
  midiOut,
  outputs,
  message,
  onMix,
  onPlayHere,
  onImport,
  onDelete,
  onMeta,
  onPlay,
  onStop,
  onMidiInit,
  onMidiIn,
  onMidiOut,
  onOutput,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [buka, setBuka] = useState<string | null>(null);

  const ubah = (ch: MixChannel, patch: { volume?: number; muted?: boolean; solo?: boolean }) =>
    onMix({
      ...mix,
      volume: { ...mix.volume, ...(patch.volume === undefined ? {} : { [ch]: patch.volume }) },
      muted: { ...mix.muted, ...(patch.muted === undefined ? {} : { [ch]: patch.muted }) },
      solo: patch.solo === undefined ? mix.solo : patch.solo ? ch : null,
    });

  const impor = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) onImport(files);
    e.currentTarget.value = '';
  };

  return (
    <section className="panel tracks-panel" aria-label="Tracks dan MIDI">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">TRACKS & MIDI</p>
          <h2 className="panel-title">{tracks.length} Track Lokal</h2>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
          + Impor Audio
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/ogg,audio/*"
        multiple
        hidden
        onChange={impor}
        aria-label="Impor berkas audio"
      />
      <p className="panel-sub">
        MP3/WAV/OGG disimpan di HP ini saja (IndexedDB). Track dihubungkan ke lagu lewat id atau
        judul yang sama.
      </p>

      {message && <p className="inline-msg">{message}</p>}

      {tracks.length === 0 ? (
        <p className="empty">Belum ada track. Impor audio untuk backing, lalu isi tuning, key, dan catatan panggung.</p>
      ) : (
        <ul className="track-list">
          {tracks.map((t) => {
            const terbuka = buka === t.id;
            return (
              <li key={t.id} className={`track-card${playingId === t.id ? ' playing' : ''}`}>
                <div className="track-head">
                  <button type="button" className="track-open" onClick={() => setBuka(terbuka ? null : t.id)}>
                    <span className="track-title">{t.title}</span>
                    <span className="track-meta">
                      {formatDuration(t.durationMs)} · {(t.size / 1_048_576).toFixed(1)} MB
                      {t.songId !== null ? ` · lagu #${t.songId}` : ' · belum terhubung'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn play"
                    onClick={() => (playingId === t.id ? onStop() : onPlay(t.id))}
                    aria-label={playingId === t.id ? `Hentikan ${t.title}` : `Putar ${t.title}`}
                  >
                    {playingId === t.id ? '■' : '▶'}
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => onDelete(t.id)} aria-label={`Hapus ${t.title}`}>
                    ×
                  </button>
                </div>

                {terbuka && (
                  <div className="track-edit">
                    <label className="edit-field">
                      <span>Lagu</span>
                      <select
                        className="input"
                        value={t.songId ?? ''}
                        onChange={(e) => onMeta(t.id, { songId: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
                      >
                        <option value="">— belum terhubung —</option>
                        {songs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.judul}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="edit-row">
                      <label className="edit-field">
                        <span>Tuning</span>
                        <input
                          className="input"
                          value={t.tuning}
                          placeholder="Drop D"
                          onChange={(e) => onMeta(t.id, { tuning: e.currentTarget.value })}
                        />
                      </label>
                      <label className="edit-field">
                        <span>Key</span>
                        <input
                          className="input"
                          value={t.key}
                          placeholder="D minor"
                          onChange={(e) => onMeta(t.id, { key: e.currentTarget.value })}
                        />
                      </label>
                      <label className="edit-field pc">
                        <span>PC</span>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={t.program}
                          onChange={(e) => onMeta(t.id, { program: Math.max(0, Math.min(127, Number(e.currentTarget.value) || 0)) })}
                        />
                      </label>
                    </div>
                    <label className="edit-field">
                      <span>Lirik / catatan panggung</span>
                      <textarea
                        className="input"
                        rows={4}
                        value={t.notes}
                        placeholder={'[Intro]\n[Verse] …'}
                        onChange={(e) => onMeta(t.id, { notes: e.currentTarget.value })}
                      />
                    </label>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mix-box">
        <p className="panel-kicker">MIXER</p>
        {CHANNELS.map((ch) => (
          <div key={ch} className="mix-row">
            <span className="mix-name">{LABEL[ch]}</span>
            <button
              type="button"
              className={`mix-btn${mix.muted[ch] ? ' on' : ''}`}
              onClick={() => ubah(ch, { muted: !mix.muted[ch] })}
              aria-pressed={mix.muted[ch]}
              aria-label={`Mute ${LABEL[ch]}`}
            >
              M
            </button>
            <button
              type="button"
              className={`mix-btn solo${mix.solo === ch ? ' on' : ''}`}
              onClick={() => ubah(ch, { solo: mix.solo !== ch })}
              aria-pressed={mix.solo === ch}
              aria-label={`Solo ${LABEL[ch]}`}
            >
              S
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(mix.volume[ch] * 100)}
              onChange={(e) => ubah(ch, { volume: Number(e.currentTarget.value) / 100 })}
              aria-label={`Volume ${LABEL[ch]}`}
            />
            <span className="mix-val">{Math.round(mix.volume[ch] * 100)}</span>
          </div>
        ))}
        <div className="mix-foot">
          <button
            type="button"
            className={`seg-btn${mix.split ? ' on' : ''}`}
            onClick={() => onMix({ ...mix, split: !mix.split })}
            aria-pressed={mix.split}
          >
            {mix.split ? 'Klik kiri · Backing kanan' : 'Stereo'}
          </button>
          <label className="switch">
            <input type="checkbox" checked={playHere} onChange={(e) => onPlayHere(e.currentTarget.checked)} />
            <span>Putar backing di HP ini</span>
          </label>
        </div>
        <label className="edit-field">
          <span>Output audio</span>
          <select className="input" defaultValue="" onChange={(e) => e.currentTarget.value && onOutput(e.currentTarget.value)}>
            <option value="">— perangkat bawaan —</option>
            {outputs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="midi-box">
        <p className="panel-kicker">WEB MIDI</p>
        {!midi.supported ? (
          <p className="panel-sub">{midi.error ?? 'Web MIDI tidak tersedia — metronom tetap berjalan tanpa MIDI.'}</p>
        ) : midi.outputs.length === 0 && midi.inputs.length === 0 ? (
          <button type="button" className="btn btn-secondary" onClick={onMidiInit}>
            Aktifkan MIDI
          </button>
        ) : (
          <>
            <label className="edit-field">
              <span>MIDI Out (Start/Stop/Clock/PC)</span>
              <select className="input" value={midiOut} onChange={(e) => onMidiOut(e.currentTarget.value)}>
                <option value="">— mati —</option>
                {midi.outputs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="edit-field">
              <span>MIDI In</span>
              <select className="input" value={midiIn} onChange={(e) => onMidiIn(e.currentTarget.value)}>
                <option value="">— tidak dipakai —</option>
                {midi.inputs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {midi.error && <p className="inline-msg">{midi.error}</p>}
      </div>
    </section>
  );
};
