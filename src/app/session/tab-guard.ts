/**
 * Penjaga satu tab pemilik audio per perangkat.
 *
 * Dua tab aplikasi yang sama dapat membuat dua ClickEngine dengan θ/kompensasi berbeda. Kalau
 * keduanya berbunyi, band mendengar dua klik yang bergeser. BroadcastChannel hanya melihat tab
 * pada origin yang sama (dan tidak menyeberang profil browser), jadi ia cukup untuk mendeteksi
 * tab kedua di HP yang sama tanpa menyentuh server.
 *
 * Pemilihan memakai kandidat dengan id tab terkecil setelah jendela singkat. Tab yang sudah
 * menjadi pemilik menjawab `pemilik`; tab baru langsung menjadi `duplikat`. Saat pemilik menutup
 * halaman, ia mengirim `lepas` supaya tab lain dapat memilih ulang.
 */

export type PeranTab = 'pemilik' | 'duplikat';

const NAMA_SALURAN = 'paranoidclick-tab';
const JEDA_PEMILIHAN_MS = 120;
const BATAS_ID = 64;

export interface SaluranTab {
  postMessage(pesan: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export interface OpsiTabGuard {
  id?: string;
  /** `null` mensimulasikan browser tanpa BroadcastChannel. */
  saluran?: SaluranTab | null;
  jedaPemilihanMs?: number;
}

export interface TabGuard {
  /** Selesai sesudah pemilihan singkat; tab baru yang melihat pemilik bisa selesai lebih awal. */
  siap: Promise<PeranTab>;
  peran(): PeranTab | null;
  /** Langganan perubahan peran; pemanggil langsung menerima peran sekarang bila sudah ada. */
  ubah(fn: (peran: PeranTab) => void): () => void;
  tutup(): void;
}

function idAcak(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Jatuh ke id waktu+acak di bawah; tidak ada yang perlu ditampilkan.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function saluranBrowser(): SaluranTab | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(NAMA_SALURAN);
  } catch {
    // Mode privasi / kebijakan browser bisa melempar konstruktor; jangan memblok audio karenanya.
    return null;
  }
}

function idSah(nilai: unknown): nilai is string {
  return typeof nilai === 'string' && nilai.length > 0 && nilai.length <= BATAS_ID;
}

export function mulaiTabGuard(opsi: OpsiTabGuard = {}): TabGuard {
  const id = opsi.id ?? idAcak();
  const saluran = opsi.saluran === undefined ? saluranBrowser() : opsi.saluran;
  const jeda = opsi.jedaPemilihanMs ?? JEDA_PEMILIHAN_MS;
  const pendengar = new Set<(peran: PeranTab) => void>();
  const kandidat = new Set<string>([id]);
  let peran: PeranTab | null = null;
  let pemilik: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let memilihUlang = false;
  let tutup = false;
  let selesaiSiap!: (peran: PeranTab) => void;
  const siap = new Promise<PeranTab>((resolve) => {
    selesaiSiap = resolve;
  });

  const kabar = (nilai: PeranTab): void => {
    if (peran === nilai) return;
    peran = nilai;
    selesaiSiap(nilai);
    for (const fn of pendengar) fn(nilai);
  };

  const kirim = (t: 'halo' | 'kandidat' | 'pemilik' | 'lepas', idPesan = id): void => {
    if (tutup || !saluran) return;
    try {
      saluran.postMessage({ t, id: idPesan });
    } catch {
      // Saluran bisa sudah ditutup oleh pagehide; bukan alasan untuk menghentikan audio.
    }
  };

  const pilih = (): void => {
    timer = null;
    if (tutup || (peran !== null && !memilihUlang)) return;
    memilihUlang = false;
    if (pemilik !== null) {
      kabar('duplikat');
      return;
    }
    const menang = [...kandidat].sort()[0] ?? id;
    if (menang === id) {
      pemilik = id;
      kabar('pemilik');
      kirim('pemilik');
    } else {
      pemilik = menang;
      kabar('duplikat');
      // Tab terkecil mengumumkan dirinya sendiri; kalau pesannya hilang, pengumuman dari
      // pemilik berikutnya tetap menyelesaikan tab ini.
    }
  };

  const pilihUlang = (): void => {
    if (tutup) return;
    if (timer !== null) clearTimeout(timer);
    // Peran `duplikat` dipertahankan selama jeda: UI tidak boleh sempat mengaktifkan kembali
    // tombol start sebelum pemilihan ulang selesai.
    memilihUlang = true;
    pemilik = null;
    kirim('halo');
    timer = setTimeout(pilih, jeda);
  };

  const terima = (event: { data: unknown }): void => {
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    const { t, id: idLain } = data as { t?: unknown; id?: unknown };
    if (!idSah(idLain) || idLain === id) return;
    if (t === 'halo') {
      kandidat.add(idLain);
      // Pemilik harus menjawab dengan id dirinya, bukan id pengirim.
      if (peran === 'pemilik') kirim('pemilik');
      else if (pemilik !== null) kirim('pemilik', pemilik);
      else kirim('kandidat');
      return;
    }
    if (t === 'kandidat') {
      kandidat.add(idLain);
      return;
    }
    if (t === 'pemilik') {
      if (peran === 'pemilik' && id < idLain) {
        // Dua tab sempat mengumumkan diri; id terkecil yang menang.
        kirim('pemilik');
        return;
      }
      pemilik = idLain;
      kabar('duplikat');
      return;
    }
    if (t === 'lepas' && pemilik === idLain) {
      // Pemilik lama pergi. Buang id-nya dari kandidat supaya tab yang tersisa tidak memilih
      // pemilik yang sudah tutup. Pemilihan ulang singkat memberi tab lain kesempatan mengambil
      // alih; sampai hasilnya keluar tab ini tetap dibisukan (tidak ada klik ganda).
      kandidat.delete(idLain);
      pilihUlang();
    }
  };

  if (!saluran) {
    // Browser lama tanpa BroadcastChannel: jangan memblok semua tab. Ini batas yang disebut di
    // README; browser modern yang mendukung API tetap memakai penjaga.
    kabar('pemilik');
  } else {
    saluran.onmessage = terima;
    kirim('halo');
    timer = setTimeout(pilih, jeda);
  }

  const padaPageHide = (): void => {
    if (peran !== 'pemilik' || tutup) return;
    // Jangan menjawab `halo` dari tab lain saat halaman sedang pergi: kalau saluran masih
    // memproses pesan, tab yang menunggu bisa melihat pemilik lama dan tetap dibisukan.
    if (saluran) saluran.onmessage = null;
    kirim('lepas');
  };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', padaPageHide);

  return {
    siap,
    peran: () => peran,
    ubah(fn) {
      pendengar.add(fn);
      if (peran !== null) fn(peran);
      return () => {
        pendengar.delete(fn);
      };
    },
    tutup() {
      if (tutup) return;
      const adalahPemilik = peran === 'pemilik';
      tutup = true;
      // Hentikan dulu penerimaan pesan. Kalau tab lain mengirim `halo` di tengah penutupan,
      // tab ini tidak boleh menjawab sebagai pemilik lama setelah mengirim `lepas`.
      if (saluran) saluran.onmessage = null;
      if (adalahPemilik && saluran) {
        try {
          saluran.postMessage({ t: 'lepas', id });
        } catch {}
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', padaPageHide);
      saluran?.close();
    },
  };
}
