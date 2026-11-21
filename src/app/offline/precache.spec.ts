import { describe, expect, it } from 'vitest';
import { parseStatusPrecache, ringkasGagalPrecache } from './precache';

const STATUS = {
  total: 3,
  gagal: [{ url: '/assets/gagal.js', message: 'HTTP 404' }],
  at: 1_700_000_000_000,
};

describe('parseStatusPrecache', () => {
  it('menerima status valid dan mempertahankan alamat aset', () => {
    expect(parseStatusPrecache(STATUS)).toEqual(STATUS);
  });

  it('menolak data rusak, bukan menampilkan peringatan karangan', () => {
    expect(parseStatusPrecache(null)).toBeNull();
    expect(parseStatusPrecache({ total: 2, at: 1, gagal: [] })).toEqual({ total: 2, at: 1, gagal: [] });
    expect(parseStatusPrecache({ total: -1, at: 1, gagal: [] })).toBeNull();
    expect(parseStatusPrecache({ total: 1.5, at: 1, gagal: [] })).toBeNull();
    expect(parseStatusPrecache({ total: 1, at: Number.NaN, gagal: [] })).toBeNull();
    expect(parseStatusPrecache({ total: 1, at: 1 })).toBeNull();
    expect(parseStatusPrecache({ total: 1, at: 1, gagal: [{ url: '', message: 'x' }] })).toBeNull();
    expect(parseStatusPrecache({ total: 0, at: 1, gagal: [{ url: '/a', message: 'x' }] })).toBeNull();
  });
});

describe('ringkasGagalPrecache', () => {
  it('menyebut jumlah, total, dan setiap URL yang gagal', () => {
    expect(ringkasGagalPrecache(STATUS)).toBe(
      'Precache tidak lengkap: 1/3 aset gagal (/assets/gagal.js). Aplikasi mungkin tidak bisa dibuka offline.',
    );
  });

  it('tidak menghasilkan teks saat semua aset berhasil', () => {
    expect(ringkasGagalPrecache({ total: 3, gagal: [], at: 1 })).toBe('');
  });
});
