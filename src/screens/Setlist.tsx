import { useState } from 'react';
import { MAX_JUDUL, MAX_SETLIST, type Song } from '../shared/setlist';
import { MAX_BPM, MIN_BPM, parseBpm } from '../shared/tempo';

export interface SetlistProps {
  songs: Song[];
  aktif: number | null;
  /** bpm grid sekarang; dipakai sebagai nilai bawaan form tambah. */
  bpmSekarang: number;
  /** Hanya pemegang `lk`; pengikut melihat daftar yang sama tanpa satu tombol pun. */
  bolehUbah: boolean;
  onTambah: (judul: string, bpm: number) => void;
  onHapus: (id: number) => void;
  onGeser: (id: number, naik: boolean) => void;
  onPilih: (id: number) => void;
}

/**
 * Setlist M3b: daftar lagu yang disiarkan server ke semua HP, plus tombol tulis untuk pemimpin.
 * Tombol boleh mati di sini, tapi yang benar-benar menolak adalah server — layar tanpa `lk`
 * hanya tidak menawarkan apa yang pasti dijawab `NOT_LEADER`.
 */
export function Setlist({ songs, aktif, bpmSekarang, bolehUbah, onTambah, onHapus, onGeser, onPilih }: SetlistProps) {
  const [judul, setJudul] = useState('');
  const [bpm, setBpm] = useState('');
  const penuh = songs.length >= MAX_SETLIST;

  const tambah = () => {
    const nama = judul.trim();
    // String kosong untuk bpm berarti "pakai tempo sekarang": itu kasus paling sering saat
    // menyusun setlist di tengah latihan, dan mengetik ulang angka yang sudah ada di header
    // adalah cara paling mudah menaruh lagu di tempo yang salah.
    const nilai = parseBpm(Number(bpm.trim() === '' ? bpmSekarang : bpm));
    if (!bolehUbah || penuh || nama.length === 0 || nilai === null) return;
    onTambah(nama, nilai);
    setJudul('');
    setBpm('');
  };

  return (
    <>
      <h2>
        Setlist ({songs.length}/{MAX_SETLIST})
      </h2>
      {songs.length === 0 ? (
        <p className="small">
          Belum ada lagu. Memilih lagu memindahkan tempo ruangan ke bpm lagu itu — lewat jalur ramp yang sama
          dengan tombol tempo, jadi tidak ada klik yang hilang di jahitannya.
        </p>
      ) : (
        songs.map((s, i) => (
          <div key={s.id} className={s.id === aktif ? 'song song-aktif' : 'song'}>
            <span className="song-nama">
              {s.id === aktif ? '▶ ' : `${i + 1}. `}
              {s.judul}
            </span>
            <span className="small">{s.bpm} BPM</span>
            {bolehUbah && (
              <span className="row">
                <button onClick={() => onGeser(s.id, true)} disabled={i === 0} className="btn btn-kecil" aria-label={`Naikkan ${s.judul}`}>
                  ↑
                </button>
                <button
                  onClick={() => onGeser(s.id, false)}
                  disabled={i === songs.length - 1}
                  className="btn btn-kecil"
                  aria-label={`Turunkan ${s.judul}`}
                >
                  ↓
                </button>
                <button onClick={() => onPilih(s.id)} className="btn btn-kecil" aria-label={`Pilih ${s.judul}`}>
                  Pilih
                </button>
                <button onClick={() => onHapus(s.id)} className="btn btn-kecil" aria-label={`Hapus ${s.judul}`}>
                  Hapus
                </button>
              </span>
            )}
          </div>
        ))
      )}

      {bolehUbah && (
        <p className="row">
          <input
            value={judul}
            onChange={(e) => setJudul(e.currentTarget.value)}
            placeholder="Judul lagu"
            maxLength={MAX_JUDUL}
            className="field field-lebar"
            aria-label="Judul lagu baru"
          />
          <input
            value={bpm}
            onChange={(e) => setBpm(e.currentTarget.value)}
            placeholder={String(bpmSekarang)}
            inputMode="numeric"
            className="field"
            aria-label={`BPM lagu baru (${MIN_BPM}–${MAX_BPM})`}
          />
          <button onClick={tambah} disabled={penuh} className="btn">
            Tambah
          </button>
        </p>
      )}
      {penuh && <p className="small">Batas {MAX_SETLIST} lagu tercapai — hapus satu untuk menambah yang lain.</p>}
    </>
  );
}
