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
    <main>
      <h1>ParanoidClick</h1>
      {badLink && (
        <p className="note warn">
          Tautan join tidak terbaca: sid harus 4 huruf/angka tanpa I O 0 1, dan tok harus 64 digit hex
          persis seperti yang dikirim pemimpin.
        </p>
      )}
      <p className="note">
        Metronom yang sama di beberapa HP. Yang membuat sesi memegang tempo; yang lain membuka tautan
        join-nya.
      </p>
      <p className="row">
        <button onClick={() => setView({ kind: 'room', role: 'leader' })} className="btn btn-lg">
          Buat sesi baru (saya pemimpin)
        </button>
        {remembered && (
          <button
            onClick={() =>
              setView({ kind: 'room', role: remembered.leader ? 'leader' : 'follower', target: remembered })
            }
            className="btn"
          >
            Lanjut ke sesi {remembered.sid}
          </button>
        )}
      </p>

      {pindai ? (
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
      ) : (
        <p className="row">
          <button onClick={() => setPindai(true)} className="btn">
            Pindai QR pemimpin
          </button>
        </p>
      )}
      {galat && <p className="note warn">{galat}</p>}
      <p className="note">
        <a href="/?layar=ukur">Alat ukur spike M0 (60 ping + latensi audio)</a>
      </p>
    </main>
  );
}
