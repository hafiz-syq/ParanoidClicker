import { useState, type FC } from 'react';
import type { ClickStats } from '../../app/audio/click';
import { targetFromUrl, type LiveTarget } from '../../app/session/live';
import { JoinQr } from '../JoinQr';
import { Scanner } from '../Scanner';

export interface BandSyncPanelProps {
  joinUrl: string;
  sid: string;
  members: number;
  theta: number | null;
  rtt: number | null;
  audioRate: number | null;
  wsOk: boolean;
  wake: string;
  comp: string;
  stats: ClickStats | null;
  stale: boolean;
  status: string;
  gridLine: string;
  onComp: (value: string) => void;
  onApplyComp: () => void;
  onJoin: (target: LiveTarget) => void;
}

const ms = (n: number | null): string => (n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} ms`);

/**
 * Tab 4: satu tempat untuk undangan dan bukti sinkronisasi.
 *
 * QR memuat `sid` + `tok` saja; `lk` tidak pernah masuk ke sini, jadi memindai QR memberi
 * kapabilitas anggota — bukan podium.
 */
export const BandSyncPanel: FC<BandSyncPanelProps> = ({
  joinUrl,
  sid,
  members,
  theta,
  rtt,
  audioRate,
  wsOk,
  wake,
  comp,
  stats,
  stale,
  status,
  gridLine,
  onComp,
  onApplyComp,
  onJoin,
}) => {
  const [pindai, setPindai] = useState(false);
  const [salin, setSalin] = useState(false);
  const [galat, setGalat] = useState('');

  const copy = () => {
    if (!joinUrl) return;
    void navigator.clipboard
      .writeText(joinUrl)
      .then(() => {
        setSalin(true);
        window.setTimeout(() => setSalin(false), 1500);
      })
      .catch(() => setGalat('tautan tidak bisa disalin — pilih teksnya manual'));
  };

  if (pindai) {
    return (
      <section className="panel" aria-label="Pindai QR pemimpin">
        <Scanner
          onResult={(teks) => {
            const target = targetFromUrl(teks);
            if (!target) {
              setGalat('QR itu bukan tautan sesi ParanoidClick.');
              return;
            }
            setPindai(false);
            onJoin(target);
          }}
          onBatal={() => setPindai(false)}
        />
        {galat && <p className="inline-msg">{galat}</p>}
      </section>
    );
  }

  return (
    <section className="panel sync-panel" aria-label="Band sync">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">BAND SYNC</p>
          <h2 className="panel-title">Sesi {sid}</h2>
        </div>
        <span className={`sync-dot${wsOk ? ' ok' : ' bad'}`} aria-hidden="true" />
      </div>

      {joinUrl ? (
        <>
          <div className="qr-box">
            <JoinQr url={joinUrl} />
          </div>
          <p className="qr-url">{joinUrl}</p>
          <div className="row-2">
            <button type="button" className="btn btn-primary" onClick={copy}>
              {salin ? 'Tautan disalin' : 'Salin Tautan Join'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPindai(true)}>
              Pindai QR Pemimpin
            </button>
          </div>
          <p className="panel-sub">
            Tautan ini adalah kunci sesi: siapa pun yang membukanya bisa masuk. Kunci pemimpin tidak
            pernah ikut di QR maupun teks.
          </p>
        </>
      ) : (
        <p className="empty">Belum ada sesi. Buat sesi dari tab Metronome untuk menampilkan QR undangan.</p>
      )}

      <div className="telemetry">
        <p className="panel-kicker">TELEMETRI</p>
        <dl className="tele-grid">
          <div>
            <dt>HP tersambung</dt>
            <dd>{members} / 12</dd>
          </div>
          <div>
            <dt>θ (server − lokal)</dt>
            <dd>{ms(theta)}</dd>
          </div>
          <div>
            <dt>RTT median</dt>
            <dd>{ms(rtt)}</dd>
          </div>
          <div>
            <dt>Laju jam audio</dt>
            <dd>{audioRate === null ? '—' : `${audioRate.toFixed(3)}×`}</dd>
          </div>
          <div>
            <dt>Layar</dt>
            <dd>{wake}</dd>
          </div>
          <div>
            <dt>Socket</dt>
            <dd>{wsOk ? 'tersambung' : 'terputus'}</dd>
          </div>
        </dl>
      </div>

      <div className="comp-box">
        <p className="panel-kicker">KOMPENSASI LATENSI</p>
        <p className="panel-sub">
          Geser klik maju sebesar jeda HP → telinga. Ukur dulu di alat ukur, lalu masukkan angkanya.
        </p>
        <div className="comp-row">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            value={comp}
            onChange={(e) => onComp(e.currentTarget.value)}
            aria-label="Kompensasi latensi dalam milidetik"
          />
          <span className="muted">ms</span>
          <button type="button" className="btn btn-secondary" onClick={onApplyComp}>
            Terapkan
          </button>
        </div>
      </div>

      <details className="diag">
        <summary>Diagnostik klik</summary>
        <pre className={`pre${stale ? ' warn' : ''}`}>
          {[
            `status: ${status}${stale ? ' · θ BASI' : ''}`,
            `θ dipakai klik = ${stats ? `${stats.thetaMs.toFixed(1)} ms` : '—'} · lompat ${stats?.thetaJumps ?? 0}× · beat tertelan ${stats?.swallowed ?? 0}`,
            `klik ${stats?.played ?? 0} berbunyi · ${stats?.missed ?? 0} hilang · ctx=${stats?.ctxState ?? '?'} · laju ${stats ? stats.audioRate.toFixed(3) : '?'}×` +
              (stats?.audioStalled ? ' · JAM AUDIO BEKU' : ''),
            stats && stats.driftSamples > 0
              ? `meleset: p50=${stats.driftP50Ms.toFixed(1)} p95=${stats.driftP95Ms.toFixed(1)} max=${stats.driftMaxMs.toFixed(1)} ms · kompensasi ${stats.latencyCompMs.toFixed(1)} ms`
              : 'meleset: belum ada klik yang selesai',
            gridLine,
          ].join('\n')}
        </pre>
      </details>
    </section>
  );
};
