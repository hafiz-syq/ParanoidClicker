import { describe, expect, it } from 'vitest';
import { MAX_JUDUL, MAX_SETLIST, parseJudul, parseSetlist, parseSong, parseSongId } from './setlist';

describe('setlist', () => {
  it('judul dipangkas dan dibatasi, bukan diterima apa adanya', () => {
    expect(parseJudul('  Intro  ')).toBe('Intro');
    expect(parseJudul('')).toBeNull();
    expect(parseJudul('   ')).toBeNull();
    expect(parseJudul('x'.repeat(MAX_JUDUL))).toBe('x'.repeat(MAX_JUDUL));
    expect(parseJudul('x'.repeat(MAX_JUDUL + 1))).toBeNull();
    expect(parseJudul(42)).toBeNull();
  });

  it('id lagu hanya bilangan bulat positif', () => {
    expect(parseSongId(7)).toBe(7);
    for (const bad of [0, -1, 1.5, '7', null, undefined, Number.NaN]) expect(parseSongId(bad)).toBeNull();
  });

  it('lagu cacat dibuang satu per satu, daftar yang sah tetap utuh', () => {
    expect(parseSong({ id: 1, judul: 'Intro', bpm: 120 })).toEqual({ id: 1, judul: 'Intro', bpm: 120 });
    for (const bpm of [0, 29, 301, 120.5, '120']) {
      expect(parseSong({ id: 1, judul: 'Intro', bpm })).toBeNull();
    }
    const list = parseSetlist([
      { id: 1, judul: 'Intro', bpm: 120 },
      { id: 2, judul: '', bpm: 120 },
      { id: 3, judul: 'Verse', bpm: 999 },
      { id: 4, judul: 'Chorus', bpm: 140 },
      'bukan lagu',
    ]);
    expect(list).toEqual([
      { id: 1, judul: 'Intro', bpm: 120 },
      { id: 4, judul: 'Chorus', bpm: 140 },
    ]);
  });

  it('frame tanpa setlist = null (server lama), dan daftar raksasa dipotong di MAX_SETLIST', () => {
    expect(parseSetlist(undefined)).toBeNull();
    expect(parseSetlist({})).toBeNull();
    const besar = Array.from({ length: MAX_SETLIST + 5 }, (_, i) => ({ id: i + 1, judul: `L${i}`, bpm: 120 }));
    expect(parseSetlist(besar)).toHaveLength(MAX_SETLIST);
  });
});
