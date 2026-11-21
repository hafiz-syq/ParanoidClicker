/**
 * Penanda kecil "ada lagu yang sedang berjalan" yang dibaca `PwaBanner`.
 *
 * Service worker baru sengaja menunggu (`SKIP_WAITING` hanya dikirim dari banner), jadi satu-satunya
 * hal yang bisa membuat versi baru mengambil alih di tengah lagu adalah banner itu sendiri. Layar
 * klik menyalakan tanda ini selama grid berjalan; banner menahan tombol muat ulang selama itu.
 */

type Pendengar = (berjalan: boolean) => void;

let berjalan = false;
const pendengar = new Set<Pendengar>();

/** Jejak lintas tab: tab yang sedang memainkan lagu menulis cap waktu, tab lain membacanya. */
export const KUNCI_LAGU = 'pc-lagu-berjalan';
/** Cap waktu lebih tua dari ini bukan lagi lagu yang sedang berbunyi (tab mati / crash). */
export const SEGAR_MS = 5_000;

function tulisLagu(main: boolean): void {
  try {
    if (main) localStorage.setItem(KUNCI_LAGU, String(Date.now()));
    else localStorage.removeItem(KUNCI_LAGU);
  } catch {
    // Mode privat: penjagaan lintas tab tidak ada, tapi tab ini tetap menahan sendiri.
  }
}

export function setSesiBerjalan(nilai: boolean): void {
  if (nilai === berjalan) return;
  berjalan = nilai;
  tulisLagu(nilai);
  for (const fn of pendengar) fn(berjalan);
}

/** Dipanggil berkala selama lagu berbunyi supaya cap waktunya tidak dianggap basi. */
export function segarkanSesiBerjalan(): void {
  if (berjalan) tulisLagu(true);
}

/** Cap waktu yang masih segar = ada tab lain yang benar-benar sedang memainkan lagu. */
export function masihSegar(cap: string | null, sekarang: number, ttlMs = SEGAR_MS): boolean {
  const t = Number(cap);
  return cap !== null && Number.isFinite(t) && t > 0 && sekarang - t >= 0 && sekarang - t < ttlMs;
}

export function adaLaguBerjalan(sekarang = Date.now()): boolean {
  if (berjalan) return true;
  try {
    return masihSegar(localStorage.getItem(KUNCI_LAGU), sekarang);
  } catch {
    return false;
  }
}

export function sesiBerjalan(): boolean {
  return berjalan;
}

/** Langganan; kembalikan fungsi pelepas. Pemanggil langsung menerima keadaan sekarang. */
export function pantauSesi(fn: Pendengar): () => void {
  pendengar.add(fn);
  fn(berjalan);
  return () => {
    pendengar.delete(fn);
  };
}
