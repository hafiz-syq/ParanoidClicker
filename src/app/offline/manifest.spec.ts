import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX, asetDariHtml, daftarCache, namaCache, versiDari } from './manifest';

// Tes ini menjaga dua hal yang tidak kelihatan di layar: daftar aset benar-benar menunjuk berkas
// hasil build (bukan `/src/main.tsx`), dan versi cache berubah bila isi build berubah.

const HTML = `<!doctype html><html><head>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/ikon/favicon-16.png" />
  <script type="module" crossorigin src="/assets/index-k_GMCr-B.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-A1b2C3.css" />
</head><body><div id="root"></div></body></html>`;

describe('asetDariHtml', () => {
  it('hanya mengambil aset ber-hash, sekali masing-masing', () => {
    expect(asetDariHtml(HTML)).toEqual(['/assets/index-k_GMCr-B.js', '/assets/index-A1b2C3.css']);
    const ganda = `<script src="/assets/a.js"></script><link href="/assets/a.js"><link href="/src/main.tsx">`;
    expect(asetDariHtml(ganda)).toEqual(['/assets/a.js']);
  });
});

describe('daftarCache', () => {
  it('hanya shell dan aset yang dirujuk HTML—tanpa ikon/manifest', () => {
    expect(daftarCache(HTML)).toEqual([
      '/',
      '/assets/index-k_GMCr-B.js',
      '/assets/index-A1b2C3.css',
    ]);
  });
});

describe('versiDari + namaCache', () => {
  const aset = asetDariHtml(HTML);

  it('deterministik, 8 digit hex, dan tidak bergantung urutan daftar aset', () => {
    const v = versiDari(HTML, aset, 'sumber');
    expect(v).toBe(versiDari(HTML, [...aset].reverse(), 'sumber'));
    expect(v).toMatch(/^[0-9a-f]{8}$/);
  });

  it('berubah bila HTML, daftar aset, atau sumber SW berubah', () => {
    const v = versiDari(HTML, aset, 'sumber');
    expect(versiDari(HTML.replace('id="root"', 'id="root" data-build="2"'), aset, 'sumber')).not.toBe(v);
    expect(versiDari(HTML, [...aset, '/assets/index-baru.js'], 'sumber')).not.toBe(v);
    expect(versiDari(HTML, aset, 'sumber lain')).not.toBe(v);
  });

  it('nama cache memakai awalan yang dipakai activate untuk membersihkan versi lama', () => {
    expect(namaCache('deadbeef')).toBe(`${CACHE_PREFIX}deadbeef`);
    expect(namaCache('deadbeef').startsWith(CACHE_PREFIX)).toBe(true);
  });

});
