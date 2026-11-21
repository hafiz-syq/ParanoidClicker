import { describe, expect, it, vi } from 'vitest';
import {
  JEDA_SESUDAH_TERLIHAT_MS,
  JEDA_UPDATE_MS,
  mulaiPemeriksaanUpdate,
  perluCekUpdate,
} from './update';

const T0 = 1_800_000_000_000;

describe('perluCekUpdate', () => {
  it('memakai batas interval yang inklusif', () => {
    expect(perluCekUpdate(T0, T0 + JEDA_UPDATE_MS - 1)).toBe(false);
    expect(perluCekUpdate(T0, T0 + JEDA_UPDATE_MS)).toBe(true);
    expect(perluCekUpdate(T0, T0 + 2 * JEDA_UPDATE_MS)).toBe(true);
  });

  it('tidak memicu saat jam mundur atau angka rusak', () => {
    expect(perluCekUpdate(T0, T0 - 1)).toBe(false);
    expect(perluCekUpdate(Number.NaN, T0)).toBe(false);
    expect(perluCekUpdate(T0, T0, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('jeda nol berarti paksa, kecuali jamnya mundur', () => {
    expect(perluCekUpdate(T0, T0, 0)).toBe(true);
    expect(perluCekUpdate(T0, T0 - 1, 0)).toBe(false);
  });
});

interface Harness {
  tick: () => void;
  tampak: () => void;
  online: () => void;
  stop: () => void;
  update: ReturnType<typeof vi.fn>;
  batalkan: ReturnType<typeof vi.fn>;
  lepasTampak: ReturnType<typeof vi.fn>;
  lepasOnline: ReturnType<typeof vi.fn>;
  setNow: (ms: number) => void;
  setTerlihat: (nilai: boolean) => void;
}

function harness(): Harness {
  let now = T0;
  let terlihat = true;
  let tick: (() => void) | null = null;
  let tampak: (() => void) | null = null;
  let online: (() => void) | null = null;
  const update = vi.fn(() => Promise.resolve());
  const batalkan = vi.fn();
  const lepasTampak = vi.fn();
  const lepasOnline = vi.fn();

  const stop = mulaiPemeriksaanUpdate(
    { update },
    {
      intervalMs: 1_000,
      resumeMs: 100,
      sekarang: () => now,
      terlihat: () => terlihat,
      jadwalkan: (fn) => {
        tick = fn;
        return 7;
      },
      batalkan,
      saatTerlihat: (fn) => {
        tampak = fn;
        return lepasTampak;
      },
      saatOnline: (fn) => {
        online = fn;
        return lepasOnline;
      },
    },
  );

  return {
    tick: () => tick?.(),
    tampak: () => tampak?.(),
    online: () => online?.(),
    stop,
    update,
    batalkan,
    lepasTampak,
    lepasOnline,
    setNow: (ms) => {
      now = ms;
    },
    setTerlihat: (nilai) => {
      terlihat = nilai;
    },
  };
}

describe('mulaiPemeriksaanUpdate', () => {
  it('tidak memeriksa saat start, lalu sekali per interval selama terlihat', async () => {
    const h = harness();
    h.tick();
    expect(h.update).not.toHaveBeenCalled();

    h.setNow(T0 + 1_000);
    h.tick();
    expect(h.update).toHaveBeenCalledTimes(1);
    // `update()` palsu selesai pada microtask; biarkan rantai catch/finally melepas guard dulu.
    await Promise.resolve();
    await Promise.resolve();

    // Tab latar tidak boleh menghasilkan fetch baru.
    h.setTerlihat(false);
    h.setNow(T0 + 5_000);
    h.tick();
    expect(h.update).toHaveBeenCalledTimes(1);

    h.setTerlihat(true);
    h.tick();
    expect(h.update).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('memakai jendela resume yang lebih pendek saat tab kembali terlihat', async () => {
    const h = harness();
    h.setNow(T0 + 50);
    h.tampak();
    expect(h.update).not.toHaveBeenCalled();

    h.setNow(T0 + 100);
    h.tampak();
    expect(h.update).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    h.stop();
  });

  it('online memaksa pemeriksaan, dan stop melepas timer serta listener', () => {
    const h = harness();
    h.online();
    expect(h.update).toHaveBeenCalledTimes(1);

    h.stop();
    expect(h.batalkan).toHaveBeenCalledWith(7);
    expect(h.lepasTampak).toHaveBeenCalledTimes(1);
    expect(h.lepasOnline).toHaveBeenCalledTimes(1);

    h.setNow(T0 + 10_000);
    h.tick();
    h.tampak();
    h.online();
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('kegagalan update tidak melempar ke pemanggil dan tidak mematikan jadwal', async () => {
    const h = harness();
    h.update.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    h.online();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.update).toHaveBeenCalledTimes(1);

    h.setNow(T0 + 10_000);
    h.tick();
    expect(h.update).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('konstanta interval lebih panjang dari jendela resume', () => {
    expect(JEDA_UPDATE_MS).toBeGreaterThan(JEDA_SESUDAH_TERLIHAT_MS);
  });
});
