import { expect, it } from 'vitest';
import { bolehBersihkanCache, cacheYangBolehDihapus, precacheAset, statusPrecache } from './sw-core.js';

// Tes ini menguji fungsi yang disuntikkan apa adanya ke dist/sw.js oleh scripts/build-sw.ts —
// bukan salinan aturan. Kalau perilaku SW dan tes berbeda, itu berarti injeksinya rusak.
const AWALAN = 'paranoidclick-';
const AKTIF = 'paranoidclick-833b046c';

it('cache lama ditahan selama masih ada tab yang bisa memakainya', () => {
  expect(
    cacheYangBolehDihapus([AKTIF, 'paranoidclick-6e3f7f09'], { aktif: AKTIF, awalan: AWALAN, bolehHapus: false }),
    'tab lama bisa mengimpor chunk ber-hash lama kapan saja — cache-nya tidak boleh dihapus',
  ).toEqual([]);
});

it('hanya SW yang masih aktif dan tidak sedang digantikan yang boleh membersihkan cache', () => {
  const saya = { state: 'activated' };
  const lain = { state: 'activated' };
  const reg = (ubah: object = {}) => ({ active: saya, installing: null, waiting: null, ...ubah });

  expect(bolehBersihkanCache(reg(), saya)).toBe(true);
  expect(bolehBersihkanCache(reg({ active: lain }), saya), 'SW lama tidak boleh menghapus cache penerus').toBe(false);
  expect(bolehBersihkanCache(reg({ installing: {} }), saya), 'versi baru sedang dipasang').toBe(false);
  expect(bolehBersihkanCache(reg({ waiting: {} }), saya), 'versi baru sedang menunggu').toBe(false);
  expect(bolehBersihkanCache(reg({ active: null }), saya)).toBe(false);
  expect(bolehBersihkanCache(reg(), null)).toBe(false);
});

it('saat aman, hanya cache versi lain dengan awalan yang sama yang dihapus', () => {
  // Cache aktif dan cache milik aplikasi lain tidak ikut; daftar kosong juga tidak menghasilkan apa-apa.
  expect(
    cacheYangBolehDihapus(
      [AKTIF, 'paranoidclick-6e3f7f09', 'aplikasi-lain', 'cache-pustaka'],
      { aktif: AKTIF, awalan: AWALAN, bolehHapus: true },
    ),
  ).toEqual(['paranoidclick-6e3f7f09']);
  expect(cacheYangBolehDihapus([AKTIF], { aktif: AKTIF, awalan: AWALAN, bolehHapus: true })).toEqual([]);
});

const tipeUntuk = (url: string) => (url.endsWith('.js') ? 'text/javascript' : url.endsWith('.css') ? 'text/css' : 'text/html');
const respons = (url: string, tipe = tipeUntuk(url)) => ({
  ok: true,
  status: 200,
  headers: { get: () => tipe },
});

it('precache mencatat URL yang gagal dan tetap mencoba URL berikutnya', async () => {
  const dicoba: string[] = [];
  const disimpan: string[] = [];
  const cache = { put: async (url: string) => void disimpan.push(url) };
  const ambil = async (url: string) => {
    dicoba.push(url);
    if (url === '/assets/gagal.js') throw new Error('HTTP 404');
    return respons(url);
  };

  const gagal = await precacheAset(cache, ['/', '/assets/gagal.js', '/assets/ok.css'], ambil);
  expect(dicoba).toEqual(['/', '/assets/gagal.js', '/assets/ok.css']);
  expect(disimpan).toEqual(['/', '/assets/ok.css']);
  expect(gagal).toEqual([{ url: '/assets/gagal.js', message: 'HTTP 404' }]);
  expect(statusPrecache(3, gagal, 1_234)).toEqual({
    total: 3,
    gagal: [{ url: '/assets/gagal.js', message: 'HTTP 404' }],
    at: 1_234,
  });
});

it('200 text/html untuk aset JS dicatat gagal, bukan disimpan sebagai JS', async () => {
  const disimpan: string[] = [];
  const cache = { put: async (url: string) => void disimpan.push(url) };
  const ambil = async () => respons('/assets/a.js', 'text/html; charset=utf-8');

  expect(await precacheAset(cache, ['/assets/a.js'], ambil)).toEqual([
    { url: '/assets/a.js', message: 'content-type text/html; charset=utf-8' },
  ]);
  expect(disimpan).toEqual([]);
});

it('precache tanpa kegagalan menghasilkan status bersih', async () => {
  const cache = { put: async () => undefined };
  const ambil = async (url: string) => respons(url);
  expect(await precacheAset(cache, ['/', '/assets/a.js'], ambil)).toEqual([]);
  expect(statusPrecache(2, [], 7)).toEqual({ total: 2, gagal: [], at: 7 });
});
