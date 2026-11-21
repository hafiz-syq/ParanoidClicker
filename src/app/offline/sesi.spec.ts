import { describe, expect, it } from 'vitest';
import { SEGAR_MS, masihSegar, pantauSesi, sesiBerjalan, setSesiBerjalan } from './sesi';

describe('sesi berjalan', () => {
  it('memberi keadaan sekarang ke pelanggan baru, dan berhenti setelah dilepas', () => {
    setSesiBerjalan(true);
    const dilihat: boolean[] = [];
    const lepas = pantauSesi((b) => dilihat.push(b));
    expect(dilihat).toEqual([true]);
    expect(sesiBerjalan()).toBe(true);

    setSesiBerjalan(false);
    expect(dilihat).toEqual([true, false]);

    lepas();
    setSesiBerjalan(true);
    expect(dilihat).toEqual([true, false]);
    setSesiBerjalan(false);
  });

  it('cap waktu lintas tab hanya segar selama TTL dan tidak menagih jam mundur', () => {
    const now = 1_800_000_000_000;
    expect(masihSegar(String(now - SEGAR_MS + 1), now)).toBe(true);
    expect(masihSegar(String(now - SEGAR_MS), now)).toBe(false);
    expect(masihSegar(String(now + 1_000), now)).toBe(false);
    expect(masihSegar(null, now)).toBe(false);
    expect(masihSegar('bukan-angka', now)).toBe(false);
    expect(masihSegar('0', now)).toBe(false);
  });

  it('tidak memberi kabar saat nilainya sama', () => {
    setSesiBerjalan(false);
    const dilihat: boolean[] = [];
    const lepas = pantauSesi((b) => dilihat.push(b));
    setSesiBerjalan(false);
    expect(dilihat).toEqual([false]);
    lepas();
  });
});
