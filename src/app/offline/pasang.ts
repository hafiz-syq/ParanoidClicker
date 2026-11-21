/**
 * M7 irisan 2 — kapan tawaran "pasang aplikasi" boleh muncul.
 *
 * Aturannya murni supaya tanggal kedaluwarsanya bisa diuji: satu-satunya cara aturan ini salah
 * tanpa kelihatan di layar adalah kalau penolakan lama (atau jam yang mundur) membuat tawaran
 * muncul terus.
 */

/** Kunci localStorage: waktu (ms) pengguna menekan "Nanti" pada tawaran pasang. */
export const KUNCI_TAWAR = 'pc-pasang-ditolak';

/** Setelah ditolak, tawaran baru boleh muncul lagi setelah 30 hari. */
export const TAWAR_ULANG_MS = 30 * 24 * 60 * 60 * 1000;

export interface KeadaanTawaran {
  /** `Date.now()` saat tawaran hendak ditampilkan. */
  sekarang: number;
  /** Isi `KUNCI_TAWAR`, atau null bila belum pernah ditolak. */
  terakhirDitolak: number | null;
  /** `matchMedia('(display-mode: standalone)').matches`. */
  standalone: boolean;
}

export interface KeadaanIos {
  userAgent: string;
  /** iPadOS 13+ menyamar sebagai Macintosh; sentuhan > 1 yang membedakannya. */
  maxTouchPoints: number;
  standalone: boolean;
}

/**
 * Safari iOS tidak pernah mengirim `beforeinstallprompt`, jadi satu-satunya jalan adalah petunjuk
 * manual: Bagikan → Tambahkan ke Layar Utama. Petunjuk hanya untuk perangkat Apple yang belum
 * berjalan standalone — di Android petunjuk itu salah dan di iOS yang sudah terpasang hanya jadi
 * gangguan.
 */
export function perluPetunjukIos({ userAgent, maxTouchPoints, standalone }: KeadaanIos): boolean {
  if (standalone) return false;
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function bolehTawarkanPasang({ sekarang, terakhirDitolak, standalone }: KeadaanTawaran): boolean {
  if (standalone) return false;
  // Nilai rusak (NaN) diperlakukan seperti belum pernah ditolak: lebih baik menawarkan sekali
  // daripada menyembunyikan tawaran selamanya karena localStorage yang diisi tangan.
  if (terakhirDitolak === null || !Number.isFinite(terakhirDitolak)) return true;
  // Jam mundur (terakhirDitolak di masa depan) menghasilkan selisih negatif → belum waktunya.
  return sekarang - terakhirDitolak >= TAWAR_ULANG_MS;
}
