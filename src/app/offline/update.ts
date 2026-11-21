/**
 * M7 irisan 3 — pemeriksaan update service worker saat halaman dibiarkan terbuka.
 *
 * `navigator.serviceWorker.register()` memeriksa `sw.js` sekali, dan browser juga memeriksa pada
 * navigasi. Itu tidak menolong tab yang sudah berhari-hari terbuka. Penjadwal ini memanggil
 * `registration.update()` berkala; SW baru tetap MENUNGGU (tidak ada skipWaiting di sini), jadi
 * pemeriksaan tidak pernah memindahkan build di tengah lagu.
 *
 * Semua ketergantungan waktu/event bisa diganti supaya penjadwal diuji tanpa DOM atau timer nyata.
 */

/** Selama halaman terlihat, periksa update paling sering sekali per 15 menit. */
export const JEDA_UPDATE_MS = 15 * 60 * 1000;
/** Saat halaman kembali terlihat, jangan langsung memeriksa bila baru saja memeriksa. */
export const JEDA_SESUDAH_TERLIHAT_MS = 60 * 1000;

export interface RegistrationUpdate {
  update(): Promise<unknown>;
}

export interface OpsiPemeriksaanUpdate {
  intervalMs?: number;
  resumeMs?: number;
  sekarang?: () => number;
  terlihat?: () => boolean;
  jadwalkan?: (fn: () => void, ms: number) => number;
  batalkan?: (id: number) => void;
  saatTerlihat?: (fn: () => void) => () => void;
  saatOnline?: (fn: () => void) => () => void;
}

/**
 * Jam pemeriksaan murni. Nilai `terakhir` di masa depan (jam mundur) tidak boleh memicu
 * pemeriksaan; selisih negatif diperlakukan sebagai belum waktunya.
 */
export function perluCekUpdate(terakhirMs: number, sekarangMs: number, jedaMs = JEDA_UPDATE_MS): boolean {
  if (!Number.isFinite(terakhirMs) || !Number.isFinite(sekarangMs) || !Number.isFinite(jedaMs)) return false;
  const selisih = sekarangMs - terakhirMs;
  if (selisih < 0) return false;
  return jedaMs <= 0 || selisih >= jedaMs;
}

/**
 * Mulai pemeriksaan berkala. `register()` sudah melakukan pemeriksaan awal, jadi `terakhir`
 * dimulai dari sekarang dan tick pertama baru terjadi sesudah satu interval.
 *
 * Kembalikan fungsi pelepas: halaman ini hidup selama app, tetapi tes dan hot-reload tetap harus
 * bisa menghentikan timer/listener tanpa meninggalkan pekerjaan di latar.
 */
export function mulaiPemeriksaanUpdate(
  reg: RegistrationUpdate,
  opsi: OpsiPemeriksaanUpdate = {},
): () => void {
  const intervalMs = opsi.intervalMs ?? JEDA_UPDATE_MS;
  const resumeMs = opsi.resumeMs ?? JEDA_SESUDAH_TERLIHAT_MS;
  const sekarang = opsi.sekarang ?? (() => Date.now());
  const terlihat = opsi.terlihat ?? (() => document.visibilityState === 'visible');
  const jadwalkan = opsi.jadwalkan ?? ((fn, ms) => window.setInterval(fn, ms));
  const batalkan = opsi.batalkan ?? ((id) => window.clearInterval(id));
  const saatTerlihat =
    opsi.saatTerlihat ??
    ((fn) => {
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    });
  const saatOnline =
    opsi.saatOnline ??
    ((fn) => {
      window.addEventListener('online', fn);
      return () => window.removeEventListener('online', fn);
    });

  let terakhir = sekarang();
  let hidup = true;
  let sedangMemeriksa = false;

  const cek = (jedaMs: number): void => {
    if (!hidup || sedangMemeriksa || !terlihat()) return;
    const saat = sekarang();
    if (!perluCekUpdate(terakhir, saat, jedaMs)) return;
    terakhir = saat;
    sedangMemeriksa = true;
    try {
      void Promise.resolve(reg.update())
        .catch(() => undefined)
        .finally(() => {
          sedangMemeriksa = false;
        });
    } catch {
      // `update()` bisa melempar sinkron pada registrasi yang sudah dilepas; jangan biarkan
      // penjadwal mati karena satu kegagalan. Percobaan berikutnya mengikuti interval normal.
      sedangMemeriksa = false;
    }
  };

  const timer = jadwalkan(() => cek(intervalMs), intervalMs);
  const lepasTerlihat = saatTerlihat(() => cek(resumeMs));
  // Kembali online adalah alasan kuat untuk mencoba sekarang, tanpa menunggu jendela 15 menit.
  const lepasOnline = saatOnline(() => cek(0));

  return () => {
    hidup = false;
    batalkan(timer);
    lepasTerlihat();
    lepasOnline();
  };
}
