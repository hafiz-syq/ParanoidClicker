import { useState } from 'react';
import { ClickRoom } from './ClickRoom';
import { Scanner } from './Scanner';
import { readRemembered, targetFromUrl, type LiveTarget } from '../app/session/live';

type View = { kind: 'menu' } | { kind: 'room'; role: 'leader' | 'follower'; target?: LiveTarget };

/**
 * Pintu masuk. Tautan join ditangani main.tsx; layar ini untuk HP yang membuka aplikasi
 * tanpa apa-apa: buat sesi baru, atau masuk lagi ke sesi yang tadi (pemandu yang layarnya
 * mati tidak boleh melahirkan sid baru dan meninggalkan sebelas HP di grid lama).
 */
export function Start({ badLink }: { badLink: boolean }) {
  const [view, setView] = useState<View>({ kind: 'menu' });
  /** Pemindai terbuka: kamera hanya hidup selama layar ini, bukan selama sesi. */
  const [pindai, setPindai] = useState(false);
  const [galat, setGalat] = useState('');
  const remembered = readRemembered();

  if (view.kind === 'room') {
    return <ClickRoom role={view.role} target={view.target} />;
  }

  return (
    <main className="landing">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          PC
        </span>
        <div>
          <h1 className="brand-name">ParanoidClick</h1>
          <p className="brand-sub">METRONOME · BAND SYNC · STAGE</p>
        </div>
      </header>

      {badLink && (
        <p className="banner warn">
          Tautan join tidak terbaca: sid harus 4 huruf/angka tanpa I O 0 1, dan tok harus 64 digit
          hex persis seperti yang dikirim pemimpin.
        </p>
      )}

      <section className="landing-card">
        <p className="panel-sub">
          Satu tempo untuk seluruh band. HP yang membuat sesi memegang podium; yang lain membuka
          tautan atau memindai QR-nya. Klik berbunyi dari jam audio masing-masing, disinkronkan ke
          server yang sama.
        </p>

        <div className="landing-actions">
          <button
            type="button"
            onClick={() => setView({ kind: 'room', role: 'leader' })}
            className="btn btn-primary btn-xl btn-block"
          >
            Buat Sesi Baru
          </button>
          {remembered && (
            <button
              type="button"
              onClick={() =>
                setView({ kind: 'room', role: remembered.leader ? 'leader' : 'follower', target: remembered })
              }
              className="btn btn-secondary btn-block"
            >
              Lanjut ke Sesi {remembered.sid}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setGalat('');
              setPindai(true);
            }}
            className="btn btn-ghost btn-block"
          >
            Pindai QR Pemimpin
          </button>
        </div>
      </section>

      {pindai && (
        <section className="landing-scan" aria-label="Pindai QR pemimpin">
          <Scanner
            onResult={(teks) => {
              // Gerbang yang sama dengan tautan yang ditempel: QR aplikasi lain, tautan tanpa
              // token, dan teks iseng ditolak di sini — bukan dipercaya karena "dipindai".
              const target = targetFromUrl(teks);
              if (!target) {
                setGalat('QR itu bukan tautan sesi ParanoidClick. Minta pemimpin menampilkan QR dari layarnya sendiri.');
                return;
              }
              setGalat('');
              setPindai(false);
              setView({ kind: 'room', role: 'follower', target });
            }}
            onBatal={() => setPindai(false)}
          />
        </section>
      )}

      {galat && <p className="banner warn">{galat}</p>}

      <footer className="landing-foot">
        <a href="/?layar=ukur">Alat ukur latensi</a>
        <span aria-hidden="true">·</span>
        <span>PWA — pasang ke layar utama untuk sesi panggung</span>
      </footer>
    </main>
  );
}
