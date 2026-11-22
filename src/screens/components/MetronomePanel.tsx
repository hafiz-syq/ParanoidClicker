import { animate } from 'animejs';
import { useEffect, useRef, type CSSProperties, type FC, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_BPM, MIN_BPM } from '../../shared/tempo';

export interface MetronomePanelProps {
  live: boolean;
  leader: boolean;
  bpm: number;
  running: boolean;
  activeBeat: number;
  beatsPerBar: number;
  subdivision: number;
  ramp: number | null;
  rampInput: string;
  countInText: string | null;
  startLabel: string;
  startDisabled: boolean;
  onStartSession: () => void;
  onBpm: (bpm: number) => void;
  onNudge: (delta: number) => void;
  onTransport: () => void;
  onTap: () => void;
  onCountIn: () => void;
  onMeter: (beats: number, subdivision: number) => void;
  onRampInput: (value: string) => void;
  onStartRamp: () => void;
  onCancelRamp: () => void;
}

const SIGNATURES = [
  { label: '4/4', beats: 4 },
  { label: '3/4', beats: 3 },
  { label: '6/8', beats: 6 },
  { label: '5/4', beats: 5 },
  { label: '7/8', beats: 7 },
];

const SUBDIVISIONS = [
  { label: 'Quarter', value: 1 },
  { label: 'Eighth', value: 2 },
  { label: 'Triplet', value: 3 },
  { label: 'Sixteenth', value: 4 },
];

const FINE = [-5, -1, 1, 5];

/** Sudut dial: −135° (BPM minimum) .. +135° (maksimum), 0° di atas. */
function bpmDariPointer(el: HTMLElement, clientX: number, clientY: number): number {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90;
  if (deg > 180) deg -= 360;
  const clamped = Math.max(-135, Math.min(135, deg));
  return Math.round(MIN_BPM + ((clamped + 135) / 270) * (MAX_BPM - MIN_BPM));
}

/**
 * Tab 1: birama, subdivision, dial tempo, dan transport. Dial hanya mengirim niat ke
 * pemimpin; pengikut tetap melihat angka yang sama tanpa bisa menggesernya.
 */
export const MetronomePanel: FC<MetronomePanelProps> = ({
  live,
  leader,
  bpm,
  running,
  activeBeat,
  beatsPerBar,
  subdivision,
  ramp,
  rampInput,
  countInText,
  startLabel,
  startDisabled,
  onStartSession,
  onBpm,
  onNudge,
  onTransport,
  onTap,
  onCountIn,
  onMeter,
  onRampInput,
  onStartRamp,
  onCancelRamp,
}) => {
  const dialRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const countRef = useRef<HTMLDivElement | null>(null);
  const pct = Math.min(1, Math.max(0, (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)));
  const angle = -135 + pct * 270;

  useEffect(() => {
    if (!countInText || !countRef.current) return;
    animate(countRef.current, {
      opacity: [0, 1],
      scale: [0.7, 1],
      duration: 180,
      easing: 'easeOutQuad',
    });
  }, [countInText]);

  const ubah = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!leader || !dialRef.current) return;
    onBpm(bpmDariPointer(dialRef.current, e.clientX, e.clientY));
  };

  return (
    <section className="panel metronome-panel" aria-label="Metronome">
      {!live && (
        <div className="start-card">
          <p className="panel-sub">
            Buat sesi baru dari HP ini, atau buka tautan/QR pemimpin. Suara baru boleh keluar sesudah
            tombol di bawah ditekan — itu aturan browser, bukan pilihan aplikasi.
          </p>
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onStartSession} disabled={startDisabled}>
            {startLabel}
          </button>
        </div>
      )}

      <div className="beat-row" aria-hidden="true">
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <span
            key={i}
            className={`beat-bar${i === 0 ? ' accent' : ''}${i === activeBeat ? ' on' : ''}`}
          />
        ))}
      </div>

      <div
        ref={dialRef}
        className={`dial${leader ? '' : ' locked'}`}
        role="slider"
        tabIndex={leader ? 0 : -1}
        aria-label={`Tempo ${bpm} BPM`}
        aria-valuemin={MIN_BPM}
        aria-valuemax={MAX_BPM}
        aria-valuenow={bpm}
        aria-disabled={!leader}
        style={{ '--dial-angle': `${angle}deg`, '--dial-pct': `${pct * 100}%` } as CSSProperties}
        onPointerDown={(e) => {
          if (!leader) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          ubah(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) ubah(e);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (!leader) return;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onBpm(Math.max(MIN_BPM, bpm - 1));
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onBpm(Math.min(MAX_BPM, bpm + 1));
          } else if (e.key === 'Home') {
            e.preventDefault();
            onBpm(MIN_BPM);
          } else if (e.key === 'End') {
            e.preventDefault();
            onBpm(MAX_BPM);
          }
        }}
      >
        <div className="dial-ticks" aria-hidden="true" />
        <div className="dial-needle" aria-hidden="true" />
        <div className="dial-center">
          <span className="dial-bpm">{bpm}</span>
          <span className="dial-unit">BPM</span>
          {leader && <span className="dial-hint">geser / panah</span>}
        </div>
      </div>

      <div className="fine-row">
        {FINE.map((step) => (
          <button
            key={step}
            type="button"
            className="fine-btn"
            disabled={!leader || !live}
            onClick={() => onNudge(step)}
            aria-label={`Tempo ${step > 0 ? '+' : ''}${step} BPM`}
          >
            {step > 0 ? `+${step}` : step}
          </button>
        ))}
      </div>

      <div className="transport-row">
        <button
          type="button"
          className={`btn-transport${running ? ' running' : ''}`}
          onClick={onTransport}
          disabled={!leader || !live}
          aria-pressed={running}
        >
          {running ? 'STOP' : 'START'}
        </button>
        <button type="button" className="btn-tap" onClick={onTap} disabled={!leader || !live}>
          TAP TEMPO
        </button>
        <button
          type="button"
          className="btn-countin"
          onClick={onCountIn}
          disabled={!leader || !live || !running}
        >
          HITUNG MASUK
        </button>
      </div>

      <div className="seg-block">
        <span className="seg-label">Time Signature</span>
        <div className="seg" role="group" aria-label="Time signature">
          {SIGNATURES.map((s) => (
            <button
              key={s.label}
              type="button"
              className={`seg-btn${s.beats === beatsPerBar ? ' on' : ''}`}
              onClick={() => onMeter(s.beats, subdivision)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="seg-block">
        <span className="seg-label">Subdivision</span>
        <div className="seg" role="group" aria-label="Subdivision">
          {SUBDIVISIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`seg-btn${s.value === subdivision ? ' on' : ''}`}
              onClick={() => onMeter(beatsPerBar, s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {leader && (
        <div className="ramp-box">
          <label className="ramp-label">
            Ramp BPM
            <input
              type="number"
              inputMode="numeric"
              min={MIN_BPM}
              max={MAX_BPM}
              value={rampInput}
              onChange={(e) => onRampInput(e.currentTarget.value)}
              className="input ramp-input"
            />
          </label>
          {ramp === null ? (
            <button type="button" className="btn btn-secondary" onClick={onStartRamp} disabled={!live || !running}>
              Mulai Ramp
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={onCancelRamp}>
              Batalkan → {ramp}
            </button>
          )}
        </div>
      )}

      {countInText && (
        <div className="countin-overlay" aria-live="assertive">
          <div ref={countRef} className="countin-text">
            {countInText}
          </div>
        </div>
      )}
    </section>
  );
};
