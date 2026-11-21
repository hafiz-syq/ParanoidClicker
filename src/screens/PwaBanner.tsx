import { useEffect, useRef, useState } from 'react';
import { KUNCI_TAWAR, bolehTawarkanPasang, perluPetunjukIos } from '../app/offline/pasang';
import { bacaStatusDariCache, parseStatusPrecache, ringkasGagalPrecache, type PrecacheStatus } from '../app/offline/precache';
import { adaLaguBerjalan, pantauSesi, sesiBerjalan } from '../app/offline/sesi';

/** `beforeinstallprompt` tidak ada di lib DOM TypeScript; hanya dua anggota yang dipakai. */
type PromptPasang = Event & { prompt: () => Promise<void> };

/** Satu pembacaan penolakan pasang, dipakai saat mount dan saat event baru datang. */
function bacaPenolakan(): number | null {
  try {
    const isi = Number(localStorage.getItem(KUNCI_TAWAR));
    return isi > 0 ? isi : null;
  } catch {
    // Mode privat / storage diblokir: anggap belum pernah ditolak.
    return null;
  }
}

/**
 * M7 irisan 2: dua pemberitahuan yang boleh ditutup.
 *
 * - Versi baru: SW baru sengaja *menunggu* (tanpa `skipWaiting` di install). Pemberitahuannya
 *   ditunda selama lagu berjalan — bukan sekadar tombolnya disembunyikan. Setelah lagu berhenti,
 *   bar baru menawarkan "Muat ulang"; memindahkan versi adalah keputusan pengguna, bukan efek
 *   samping browser. Deteksi SW tetap berjalan, tetapi tidak ada satu pun jalur untuk memutus
 *   band di tengah lagu.
 * - Deteksi lintas tab bisa basi (tab pemutar di-throttle browser), jadi handler "Muat ulang"
 *   memeriksa ulang tanda lagu dan menolak reload sebelum mengirim `SKIP_WAITING`.
 * - "Nanti" menutup pemberitahuan versi untuk halaman ini, termasuk bila update berikutnya datang
 *   beruntun; pengingat ulang setelah ditutup belum diinginkan.
 * - Pasang aplikasi: hanya muncul kalau browser memang mengirim `beforeinstallprompt`, dan setelah
 *   "Nanti" tidak ditawarkan lagi selama 30 hari (`bolehTawarkanPasang`).
 * - iOS Safari tidak punya `beforeinstallprompt`; di sana yang muncul petunjuk manual
 *   Bagikan → Tambahkan ke Layar Utama, dengan penundaan 30 hari yang sama.
 */
export function PwaBanner() {
  const [versiBaru, setVersiBaru] = useState(false);
  const [pasang, setPasang] = useState<PromptPasang | null>(null);
  const [precache, setPrecache] = useState<PrecacheStatus | null>(null);
  const [precacheTutup, setPrecacheTutup] = useState(false);
  const [jalan, setJalan] = useState(sesiBerjalan);
  const [petunjukIos, setPetunjukIos] = useState(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    const ios = perluPetunjukIos({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      standalone,
    });
    return (
      ios &&
      bolehTawarkanPasang({ sekarang: Date.now(), terakhirDitolak: bacaPenolakan(), standalone })
    );
  });
  /** Hanya reload kalau *kita* yang meminta pindah versi, bukan karena `claim()` pertama. */
  const diminta = useRef(false);
  /** Sekali "Nanti" ditekan, jangan tawarkan versi lagi di halaman ini. */
  const versiDitolak = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    const abort = new AbortController();
    const { signal } = abort;

    const pakaiStatus = (status: PrecacheStatus | null) => {
      if (!status) return;
      setPrecache(status);
      setPrecacheTutup(false);
    };
    const terimaStatus = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; status?: unknown } | null;
      if (data?.type !== 'PRECACHE_STATUS') return;
      pakaiStatus(parseStatusPrecache(data.status));
    };
    const bacaStatusSekarang = () => {
      void bacaStatusDariCache().then((status) => {
        if (!signal.aborted) pakaiStatus(status);
      });
    };
    // Pesan install bisa datang sebelum listener ini ada (mis. install pertama), jadi cache
    // status juga dibaca langsung dan lagi saat pekerja selesai/gagal. Pesan tetap dipakai untuk
    // update berikutnya.
    sw.addEventListener('message', terimaStatus, { signal });
    bacaStatusSekarang();

    // `updatefound` bisa sudah lewat sebelum `ready` selesai, jadi pekerja yang sedang memasang
    // diawasi langsung; `cek()` menangkap yang sudah lebih dulu berstatus installed.
    const awasi = (pekerja: ServiceWorker | null) => {
      if (!pekerja) return;
      const cek = () => {
        if (pekerja.state === 'installed' && !versiDitolak.current && sw.controller) setVersiBaru(true);
        // Status ditulis sebelum install resolve/reject; baca lagi saat state berubah supaya
        // kegagalan install yang terjadi sesudah mount tetap muncul tanpa DevTools.
        if (pekerja.state === 'installed' || pekerja.state === 'redundant') bacaStatusSekarang();
      };
      pekerja.addEventListener('statechange', cek, { signal });
      cek();
    };

    const pantau = (reg: ServiceWorkerRegistration) => {
      if (signal.aborted) return;
      // Waiting yang sudah ada dibaca langsung; yang masih memasang diawasi sampai `installed`.
      if (reg.waiting && sw.controller && !versiDitolak.current) setVersiBaru(true);
      awasi(reg.installing);
      reg.addEventListener('updatefound', () => awasi(reg.installing), { signal });
    };

    sw.ready.then(pantau).catch(() => undefined);

    const ganti = () => {
      if (diminta.current) location.reload();
    };
    sw.addEventListener('controllerchange', ganti, { signal });
    return () => abort.abort();
  }, []);

  // Satu sumber kebenaran: layar klik yang menyalakan/mematikan tanda ini.
  useEffect(() => pantauSesi(setJalan), []);

  // Lagu bisa berjalan di tab LAIN: selama ada tawaran versi baru, cap waktu lintas tab dibaca
  // ulang tiap detik supaya tombol muat ulang tidak langsung memindahkan build hanya karena tab
  // ini diam sementara HP lain sedang memainkan lagu.
  useEffect(() => {
    if (!versiBaru) return;
    const periksa = () => setJalan(sesiBerjalan() || adaLaguBerjalan());
    periksa();
    const id = setInterval(periksa, 1_000);
    return () => clearInterval(id);
  }, [versiBaru]);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;

    const tampil = (event: Event) => {
      event.preventDefault();
      // Dibaca di setiap tawaran, bukan sekali saat mount: penolakan yang baru saja disimpan
      // harus langsung berlaku untuk event berikutnya di halaman yang sama.
      if (!bolehTawarkanPasang({ sekarang: Date.now(), terakhirDitolak: bacaPenolakan(), standalone })) return;
      setPasang(event as PromptPasang);
    };
    const terpasang = () => setPasang(null);
    window.addEventListener('beforeinstallprompt', tampil);
    window.addEventListener('appinstalled', terpasang);
    return () => {
      window.removeEventListener('beforeinstallprompt', tampil);
      window.removeEventListener('appinstalled', terpasang);
    };
  }, []);

  const muatUlang = () => {
    // Tombol tidak dirender saat `jalan`, tetapi lagu bisa mulai di tab lain di antara render dan
    // klik. Tolak di handler juga; jangan pernah mengirim SKIP_WAITING di tengah lagu.
    if (sesiBerjalan() || adaLaguBerjalan()) {
      setJalan(true);
      return;
    }
    if (!window.confirm('Muat ulang sekarang? Kalau ada HP yang sedang memainkan lagu, semuanya akan terputus.')) return;

    diminta.current = true;
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
      })
      .catch(() => location.reload());
  };

  const nantiVersi = () => {
    versiDitolak.current = true;
    setVersiBaru(false);
  };

  const nantiPasang = () => {
    try {
      localStorage.setItem(KUNCI_TAWAR, String(Date.now()));
    } catch {
      // Tidak bisa menyimpan penolakan: bar ditutup untuk halaman ini saja.
    }
    setPasang(null);
    setPetunjukIos(false);
  };

  // `jalan` hanya tahu tab ini. `adaLaguBerjalan()` menutup celah tab lain yang memulai lagu
  // sebelum interval 1 detik sempat memperbarui state: pemberitahuan versi tetap ditunda.
  const laguBerjalan = jalan || adaLaguBerjalan();
  const tampilVersi = versiBaru && !laguBerjalan;

  if (!tampilVersi && !pasang && !petunjukIos && !(precache && precache.gagal.length > 0 && !precacheTutup)) return null;

  return (
    <div className="pwa">
      {precache && precache.gagal.length > 0 && !precacheTutup && (
        <div className="pwa-baris" role="alert">
          <span className="warn">{ringkasGagalPrecache(precache)}</span>
          <button className="btn pwa-tutup" onClick={() => setPrecacheTutup(true)}>
            Tutup
          </button>
        </div>
      )}
      {tampilVersi && (
        <div className="pwa-baris" role="status">
          <span>Versi baru sudah siap. Muat ulang supaya semua HP memakai build yang sama.</span>
          <button className="btn" onClick={muatUlang}>
            Muat ulang
          </button>
          <button className="btn pwa-tutup" onClick={nantiVersi}>
            Nanti
          </button>
        </div>
      )}
      {petunjukIos && !pasang && (
        <div className="pwa-baris" role="status">
          <span>
            Pasang di iPhone/iPad: tombol <b>Bagikan</b> di Safari → <b>Tambahkan ke Layar Utama</b>. Tanpa itu, tab
            bisa ditidurkan dan klik berhenti diam-diam.
          </span>
          <button className="btn pwa-tutup" onClick={nantiPasang}>
            Mengerti
          </button>
        </div>
      )}
      {pasang && (
        <div className="pwa-baris" role="status">
          <span>Pasang ParanoidClick supaya bisa dibuka layar penuh tanpa address bar.</span>
          <button
            className="btn"
            onClick={() => {
              void pasang.prompt();
              setPasang(null);
            }}
          >
            Pasang
          </button>
          <button className="btn pwa-tutup" onClick={nantiPasang}>
            Nanti
          </button>
        </div>
      )}
    </div>
  );
}
