import { useEffect, useState } from 'react';

type PesanVersi = {
  type?: unknown;
  version?: unknown;
};

function pendek(cache: string): string {
  return cache.startsWith('paranoidclick-') ? cache.slice('paranoidclick-'.length) : cache;
}

/**
 * Menampilkan versi cache milik service worker yang SEDANG mengontrol halaman ini.
 * Bukan versi yang sedang menunggu: kalau beberapa HP memakai build berbeda, angka ini
 * yang harus dibandingkan sebelum menyalahkan jaringan atau fase.
 *
 * SW lama yang belum mengenal pesan ini tidak diubah perilakunya; badge akan menyebut
 * bahwa versi tidak tersedia sampai SW baru aktif.
 */
export function BuildVersion() {
  const [versi, setVersi] = useState<string | null>(null);
  const [status, setStatus] = useState('menghubungi SW aktif…');

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setStatus('SW tidak tersedia');
      return;
    }
    const abort = new AbortController();
    const { signal } = abort;
    let hidup = true;
    let dijawab = false;

    const terima = (event: MessageEvent) => {
      const data = event.data as PesanVersi | null;
      if (data?.type !== 'SW_VERSION' || typeof data.version !== 'string' || !data.version) return;
      dijawab = true;
      if (hidup) {
        setVersi(data.version);
        setStatus('');
      }
    };
    const tanya = (sw: ServiceWorker | null) => {
      if (!sw || sw.state !== 'activated') return;
      sw.postMessage({ type: 'SW_VERSION' });
    };
    // Saat mount, SW bisa masih `activating`; `ready` sudah memberi objeknya tetapi
    // `postMessage` belum boleh dikirim. Tunggu statechange sekali, jangan menganggap
    // tidak ada versi hanya karena balapan aktivasi. Ini tidak mengubah lifecycle SW.
    const tanyaSaatAktif = (sw: ServiceWorker | null) => {
      if (!sw) return;
      if (sw.state === 'activated') {
        tanya(sw);
        return;
      }
      sw.addEventListener('statechange', () => tanya(sw), { signal });
    };
    const tanyaAktif = () => {
      const sw = navigator.serviceWorker.controller;
      if (sw) tanya(sw);
    };

    navigator.serviceWorker.addEventListener('message', terima, { signal });
    tanyaAktif();
    void navigator.serviceWorker.ready.then((reg) => {
      if (hidup && !dijawab) tanyaSaatAktif(reg.active);
    });
    const padaGanti = () => {
      dijawab = false;
      setVersi(null);
      setStatus('menghubungi SW aktif…');
      tanyaAktif();
    };
    navigator.serviceWorker.addEventListener('controllerchange', padaGanti, { signal });

    const batas = window.setTimeout(() => {
      if (hidup && !dijawab) setStatus('versi SW aktif tidak menjawab');
    }, 2_000);

    return () => {
      hidup = false;
      window.clearTimeout(batas);
      abort.abort();
    };
  }, []);

  return (
    <p className="note build" title={versi ? `cache aktif: ${versi}` : undefined}>
      SW build <b>{versi ? pendek(versi) : status}</b>
    </p>
  );
}
