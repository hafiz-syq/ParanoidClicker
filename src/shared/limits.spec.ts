import { describe, expect, it } from 'vitest';
import { genPin, genSid, isSid } from './ids';
import { FrameReject, checkShape, maxNesting, parseFrame } from './limits';

describe('ids', () => {
  it('sid memakai alfabet tanpa I O 0 1 dan selalu lolos isSid', () => {
    for (let i = 0; i < 500; i++) {
      const sid = genSid();
      expect(sid).toHaveLength(4);
      expect(isSid(sid)).toBe(true);
    }
  });

  it('isSid menolak format lain', () => {
    for (const bad of ['', 'ABC', 'ABCDE', 'IOI0', 'a1b2', 'ABCD1', null, 42]) {
      expect(isSid(bad)).toBe(false);
    }
  });

  it('pin selalu 6 digit dan boleh diawali nol', () => {
    for (let i = 0; i < 500; i++) expect(genPin()).toMatch(/^[0-9]{6}$/);
  });

  // Kalau bias itu dibiarkan, angka 0..5 keluar lebih sering daripada 6..9.
  it('genPin seragam: 250..255 dibuang', () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 40_000; i++) for (const d of genPin()) counts[Number(d)]++;
    const total = counts.reduce((a, b) => a + b, 0);
    for (const c of counts) expect(Math.abs(c / total - 0.1)).toBeLessThan(0.01);
  });
});

describe('limits', () => {
  it('menolak frame melebihi batas byte sebelum parse', () => {
    const bomb = JSON.stringify({ t: 'x', name: 'a'.repeat(9000) });
    expect(() => parseFrame(bomb)).toThrowError(/frame/);
  });

  it('menolak bom kurung tanpa memanggil JSON.parse', () => {
    // Sengaja di bawah MAX_FRAME_BYTES supaya yang menguji adalah gerbang kedalaman,
    // bukan gerbang ukuran (bom 200 KB sudah lebih dulu ditolak sebagai TOO_BIG).
    const bomb = '['.repeat(500);
    expect(maxNesting(bomb)).toBeGreaterThan(4);
    let caught: unknown;
    try {
      parseFrame(bomb);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FrameReject);
    expect((caught as FrameReject).code).toBe('TOO_DEEP');
  });

  it('menolak key __proto__ dan tidak mencemari prototype', () => {
    let code = '';
    try {
      parseFrame('{"t":"profile","profile":{"__proto__":{"comp":99999}}}');
    } catch (e) {
      code = (e as FrameReject).code;
    }
    expect(code).toBe('BAD_KEY');
    expect(({} as Record<string, unknown>).comp).toBeUndefined();
  });

  it('menolak string panjang di dalam payload', () => {
    expect(() => checkShape({ title: 'x'.repeat(300) })).toThrowError(/string/);
  });

  it('frame sah lolos dan field-nya terbaca', () => {
    const frame = parseFrame(JSON.stringify({ v: 1, t: 'ping', sid: '7KQ2', did: 'a1b2', nonce: 9, t1: 1234 }));
    expect(frame.t).toBe('ping');
    expect(frame.sid).toBe('7KQ2');
  });

  it('kedalaman tepat di batas lolos, satu lebih dalam ditolak', () => {
    expect(() => parseFrame('{"a":{"b":{"c":1}}}')).not.toThrow();
    expect(() => parseFrame('{"a":{"b":{"c":{"d":1}}}}')).toThrowError(/nesting/);
  });
});
