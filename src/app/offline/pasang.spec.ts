import { describe, expect, it } from 'vitest';
import { TAWAR_ULANG_MS, bolehTawarkanPasang, perluPetunjukIos } from './pasang';

const HARI = 24 * 60 * 60 * 1000;
const SEKARANG = 1_800_000_000_000;

describe('bolehTawarkanPasang', () => {
  it('menawarkan bila belum pernah ditolak', () => {
    expect(bolehTawarkanPasang({ sekarang: SEKARANG, terakhirDitolak: null, standalone: false })).toBe(true);
  });

  it('diam selama 30 hari sesudah ditolak, lalu menawarkan lagi', () => {
    expect(bolehTawarkanPasang({ sekarang: SEKARANG, terakhirDitolak: SEKARANG - HARI, standalone: false })).toBe(false);
    expect(
      bolehTawarkanPasang({ sekarang: SEKARANG, terakhirDitolak: SEKARANG - (TAWAR_ULANG_MS - 1), standalone: false }),
    ).toBe(false);
    // Tepat 30 hari: sudah boleh. Batas inklusif supaya tidak bergantung pada satu milidetik.
    expect(
      bolehTawarkanPasang({ sekarang: SEKARANG, terakhirDitolak: SEKARANG - TAWAR_ULANG_MS, standalone: false }),
    ).toBe(true);
  });

  it('tidak menawarkan saat aplikasi sudah berjalan standalone', () => {
    expect(bolehTawarkanPasang({ sekarang: SEKARANG, terakhirDitolak: null, standalone: true })).toBe(false);
  });

  it('petunjuk iOS hanya untuk iPhone/iPad yang belum standalone', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    expect(perluPetunjukIos({ userAgent: iphone, maxTouchPoints: 5, standalone: false })).toBe(true);
    expect(perluPetunjukIos({ userAgent: iphone, maxTouchPoints: 5, standalone: true })).toBe(false);
    // iPadOS 13+ mengaku Macintosh; sentuhan yang membedakannya dari Mac sungguhan.
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(perluPetunjukIos({ userAgent: ipad, maxTouchPoints: 5, standalone: false })).toBe(true);
    expect(perluPetunjukIos({ userAgent: ipad, maxTouchPoints: 0, standalone: false })).toBe(false);
    // Android tidak boleh melihat instruksi Safari.
    expect(
      perluPetunjukIos({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120', maxTouchPoints: 5, standalone: false }),
    ).toBe(false);
  });

  it('tidak menagih bila jam mundur, dan tidak terkunci selamanya oleh nilai rusak', () => {
    expect(bolehTawarkanPasang({ sekarang: SEKARANG, terakhirDitolak: SEKARANG + HARI, standalone: false })).toBe(false);
    expect(bolehTawarkanPasang({ sekarang: SEKARANG, terakhirDitolak: Number.NaN, standalone: false })).toBe(true);
  });
});
