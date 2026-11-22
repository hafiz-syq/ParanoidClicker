import type { FC } from 'react';

export interface StatusBarProps {
  leader: boolean;
  hasKey: boolean;
  podiumLost: boolean;
  live: boolean;
  members: number;
  wsOk: boolean;
  theta: number | null;
  onClaim: () => void;
  onResync: () => void;
  onInvite: () => void;
}

const ms = (n: number | null): string => (n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} ms`);

/**
 * Bar status yang selalu terlihat selama sesi: peran, tombol rebut podium, dan denyut
 * sinkronisasi. Angka di sini adalah yang dibaca operator saat band bilang "kliknya beda",
 * jadi θ dan status socket tidak boleh disembunyikan di tab lain.
 */
export const StatusBar: FC<StatusBarProps> = ({
  leader,
  hasKey,
  podiumLost,
  live,
  members,
  wsOk,
  theta,
  onClaim,
  onResync,
  onInvite,
}) => (
  <header className="statusbar">
    <div className="statusbar-top">
      <span className={`role-badge${leader ? ' leader' : ''}`}>
        {leader ? 'LEADER · PODIUM AKTIF' : live ? 'FOLLOWER · TERSINKRON' : 'BELUM TERHUBUNG'}
      </span>
      {hasKey && (!leader || podiumLost) && (
        <button type="button" className="btn btn-claim" onClick={onClaim}>
          Ambil Kendali
        </button>
      )}
    </div>
    <div className="sync-pill">
      <span className={`sync-dot${wsOk ? ' ok' : ' bad'}`} aria-hidden="true" />
      <span className="sync-count">
        {members} / 12 HP
      </span>
      <span className="sync-theta">θ {ms(theta)}</span>
      <button type="button" className="sync-btn" onClick={onResync} disabled={!live}>
        Sync Ulang
      </button>
      <button type="button" className="sync-btn" onClick={onInvite} disabled={!live}>
        Undang / QR
      </button>
    </div>
  </header>
);
