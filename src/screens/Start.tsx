import { useState, type CSSProperties } from 'react';
import { ClickRoom } from './ClickRoom';
import { readRemembered, type LiveTarget } from '../app/session/live';

type View = { kind: 'menu' } | { kind: 'room'; role: 'leader' | 'follower'; target?: LiveTarget };

/**
 * Pintu masuk. Tautan join ditangani main.tsx; layar ini untuk HP yang membuka aplikasi
 * tanpa apa-apa: buat sesi baru, atau masuk lagi ke sesi yang tadi (pemandu yang layarnya
 * mati tidak boleh melahirkan sid baru dan meninggalkan sebelas HP di grid lama).
 */
export function Start({ badLink }: { badLink: boolean }) {
  const [view, setView] = useState<View>({ kind: 'menu' });
  const remembered = readRemembered();

  if (view.kind === 'room') {
    return <ClickRoom role={view.role} target={view.target} />;
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 520 }}>
      <h1 style={{ fontSize: 20 }}>ParanoidClick</h1>
      {badLink && (
        <p style={{ ...note, color: '#f99' }}>
          Tautan join tidak terbaca: sid harus 4 huruf/angka tanpa I O 0 1, dan tok harus 64 digit hex
          persis seperti yang dikirim pemimpin.
        </p>
      )}
      <p style={note}>
        Metronom yang sama di beberapa HP. Yang membuat sesi memegang tempo; yang lain membuka tautan
        join-nya.
      </p>
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setView({ kind: 'room', role: 'leader' })} style={{ ...btn, fontSize: 18 }}>
          Buat sesi baru (saya pemimpin)
        </button>
        {remembered && (
          <button
            onClick={() =>
              setView({ kind: 'room', role: remembered.leader ? 'leader' : 'follower', target: remembered })
            }
            style={btn}
          >
            Lanjut ke sesi {remembered.sid}
          </button>
        )}
      </p>
      <p style={{ fontSize: 13 }}>
        <a href="/?layar=ukur" style={{ color: '#9cf' }}>
          Alat ukur spike M0 (60 ping + latensi audio)
        </a>
      </p>
    </main>
  );
}

const btn: CSSProperties = {
  padding: '12px 16px',
  fontSize: 15,
  background: '#1b1b22',
  color: '#eee',
  border: '1px solid #444',
  borderRadius: 8,
};

const note: CSSProperties = { fontSize: 13, lineHeight: 1.5 };
