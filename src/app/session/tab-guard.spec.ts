import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulaiTabGuard, type SaluranTab, type TabGuard } from './tab-guard';

/**
 * BroadcastChannel palsu: pesan dikirim ke semua saluran lain, bukan ke pengirim. Tes memakai
 * id eksplisit supaya pemenang pemilihan tidak bergantung pada UUID acak.
 */
class Hub {
  private readonly saluran = new Set<SaluranTab & { nama: string }>();

  buat(nama: string): SaluranTab & { nama: string } {
    const saluran = {
      nama,
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: (data: unknown) => {
        for (const lain of this.saluran) {
          if (lain !== saluran) lain.onmessage?.({ data } as MessageEvent);
        }
      },
      close: () => {
        this.saluran.delete(saluran);
      },
    };
    this.saluran.add(saluran);
    return saluran;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function jadikanPemilik(hub: Hub, id: string): TabGuard {
  const guard = mulaiTabGuard({ id, saluran: hub.buat(id), jedaPemilihanMs: 100 });
  vi.advanceTimersByTime(100);
  expect(guard.peran()).toBe('pemilik');
  return guard;
}

describe('mulaiTabGuard', () => {
  it('tab pertama menjadi pemilik dan tab berikutnya menjadi duplikat', () => {
    const hub = new Hub();
    const a = jadikanPemilik(hub, 'a');
    const b = mulaiTabGuard({ id: 'b', saluran: hub.buat('b'), jedaPemilihanMs: 100 });

    // Balasan pemilik datang sinkron di hub palsu; tidak perlu menunggu timer.
    expect(b.peran()).toBe('duplikat');
    expect(a.peran()).toBe('pemilik');
    a.tutup();
    b.tutup();
  });

  it('dua tab yang mulai bersamaan memilih satu pemenang, bukan dua pemilik', () => {
    const hub = new Hub();
    const a = mulaiTabGuard({ id: 'a', saluran: hub.buat('a'), jedaPemilihanMs: 100 });
    const b = mulaiTabGuard({ id: 'b', saluran: hub.buat('b'), jedaPemilihanMs: 100 });

    vi.advanceTimersByTime(100);
    expect([a.peran(), b.peran()].sort()).toEqual(['duplikat', 'pemilik']);
    expect(a.peran()).toBe('pemilik');
    a.tutup();
    b.tutup();
  });

  it('tab kedua langsung mengikuti pemilik yang sudah ada', async () => {
    const hub = new Hub();
    const a = jadikanPemilik(hub, 'a');
    const b = mulaiTabGuard({ id: 'b', saluran: hub.buat('b'), jedaPemilihanMs: 100 });
    await expect(b.siap).resolves.toBe('duplikat');
    a.tutup();
    b.tutup();
  });

  it('pemilik yang menutup halaman membebaskan tab lain untuk mengambil alih', () => {
    const hub = new Hub();
    const a = jadikanPemilik(hub, 'a');
    const b = mulaiTabGuard({ id: 'b', saluran: hub.buat('b'), jedaPemilihanMs: 100 });
    expect(b.peran()).toBe('duplikat');

    a.tutup();
    expect(b.peran()).toBe('duplikat'); // masih menunggu pemilihan ulang
    vi.advanceTimersByTime(100);
    expect(b.peran()).toBe('pemilik');
    b.tutup();
  });

  it('pesan cacat tidak mengubah peran', () => {
    const hub = new Hub();
    const saluranA = hub.buat('a') as SaluranTab;
    const a = mulaiTabGuard({ id: 'a', saluran: saluranA, jedaPemilihanMs: 100 });
    // Bentuk asing / id terlalu panjang harus diabaikan, bukan dipercaya.
    saluranA.onmessage?.({ data: { t: 'pemilik', id: '' } } as MessageEvent);
    saluranA.onmessage?.({ data: { t: 'pemilik', id: 'x'.repeat(65) } } as MessageEvent);
    saluranA.onmessage?.({ data: 'bukan-objek' } as MessageEvent);
    expect(a.peran()).toBeNull();
    vi.advanceTimersByTime(100);
    expect(a.peran()).toBe('pemilik');
    a.tutup();
  });

  it('tanpa BroadcastChannel tidak memblok tab (batas browser lama)', () => {
    const guard = mulaiTabGuard({ id: 'a', saluran: null });
    expect(guard.peran()).toBe('pemilik');
    guard.tutup();
  });
});
