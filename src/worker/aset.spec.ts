import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import worker from './index';

// `not_found_handling: single-page-application` menjawab path asing dengan index.html. Untuk
// `/assets/*` itu layar putih: browser menolak modul ber-MIME text/html. Env ASSETS diganti
// stub supaya tes ini tidak butuh `dist/` hasil build.
const html = () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
const js = () => new Response('console.log(1)', { status: 200, headers: { 'content-type': 'text/javascript' } });

function req(path: string, aset: () => Promise<Response>) {
  const denganAset = { ...env, ASSETS: { fetch: aset } } as unknown as Env;
  return worker.fetch(new Request(`https://example.com${path}`), denganAset);
}

it('aset JS yang tidak dikenal dijawab 404, bukan HTML', async () => {
  const res = await req('/assets/index-hilang.js', async () => html());
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).not.toContain('text/html');
});

it('aset JS yang ada diteruskan apa adanya', async () => {
  const res = await req('/assets/index-abc.js', async () => js());
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/javascript');
});

it('rute SPA tetap mendapat index.html', async () => {
  const res = await req('/gabung', async () => html());
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
});
