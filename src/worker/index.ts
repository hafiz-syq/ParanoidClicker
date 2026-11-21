import { genSid, isSid } from '../shared/ids';
import { leaderKey, sessionToken, verifySessionToken } from './keys';
import { SessionDO } from './SessionDO';

export { SessionDO };

const IP = 'CF-Connecting-IP';

/** Query yang membawa kapabilitas; nilainya disamarkan sebelum menyentuh log. */
const SECRET_QUERY = ['tok', 'lk', 'leaderKey', 'key'];

/**
 * Shim log LOKAL untuk `attack.ts` (T9c). `wrangler dev` hanya mencetak pathname, jadi tanpa
 * baris ini T9b lulus secara hampa: tidak ada satu pun URL di log yang bisa dijadikan kendali
 * positif. Yang ditulis adalah method + path + query dengan nilai rahasia diganti `***` — log
 * tetap merekam bahwa URL-nya ada (sid terlihat), tanpa menyalin kapabilitas ke disk.
 * Hanya hidup kalau `PC_LOG_URLS=1`, dan variabel itu hanya dipasang script dev lokal.
 */
function logRequest(request: Request): void {
  const u = new URL(request.url);
  for (const k of SECRET_QUERY) if (u.searchParams.has(k)) u.searchParams.set(k, '***');
  console.log(`[req] ${request.method} ${u.pathname}${u.search}`);
}

// Tanpa kunci, token apa pun yang kami mint bisa dihitung ulang oleh siapa pun, jadi dua rute
// di bawah harus menolak, bukan melayani sesi yang gerbangnya tidak ada.
function noKey(env: Env): Response | null {
  return (env.SESSION_SIGNING_KEY ?? '').length === 0 ? json({ error: 'NO_KEY' }, 500) : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if ((env as unknown as Record<string, string | undefined>)['PC_LOG_URLS'] === '1') logRequest(request);

    // CORS untuk WebSocket upgrade dan POST /create saat frontend di domain lain (Vercel).
    if (request.method === 'OPTIONS' && (url.pathname === '/ws' || url.pathname === '/create')) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': (env as unknown as Record<string, string | undefined>)['PC_ALLOWED_ORIGIN'] ?? '*',
          'Access-Control-Allow-Methods': 'POST,GET,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,Upgrade,Connection',
        },
      });
    }

    if (url.pathname === '/health') {
      // keyPresent, bukan panjangnya: cukup untuk membuktikan `wrangler secret put` menempel
      // di deployment tanpa membocorkan apa pun tentang kunci.
      // proto 2 = frame tempo/start/stop + state mulai 14 Nov 2026. `members` yang ikut di
      // state pada 15 Nov tidak menaikkan angka ini: klien lama mengabaikan key ekstra,
      // dan klien baru tetap benar kalau server lama tidak mengirimnya.
      return json({ ok: true, proto: 2, keyPresent: (env.SESSION_SIGNING_KEY ?? '').length > 0 });
    }

    if (url.pathname === '/create') {
      const blocked = noKey(env);
      if (blocked) return blocked;
      if (request.method !== 'POST') return json({ error: 'PROTO' }, 405);
      const { success } = await env.CREATE_LIMITER.limit({ key: request.headers.get(IP) ?? 'no-ip' });
      if (!success) return json({ error: 'RATE_LIMITED' }, 429);
      // Sengaja tidak menyentuh DO di sini: badai /create tidak boleh melahirkan DO kosong.
      const sid = genSid();
      const token = await sessionToken(sid, env);
      // `leaderKey` hanya keluar di JSON ini. `wsPath` — yang disalin ke tautan join dan
      // nanti jadi QR — sengaja TIDAK memuatnya: yang dibagikan tetap cuma kapabilitas sesi.
      return json({ sid, token, leaderKey: await leaderKey(sid, env), wsPath: `/ws?sid=${sid}&tok=${token}` });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected Upgrade: websocket' }, 426);
      }
      const sid = url.searchParams.get('sid');
      if (!isSid(sid)) return json({ error: 'PROTO' }, 400);
      const blocked = noKey(env);
      if (blocked) return blocked;
      // Tanpa gerbang ini, rate limit /create tidak mengikat apa pun: `/ws?sid=XXXX` yang
      // ditebak sendiri sudah cukup untuk melahirkan 1 DO SQLite, dan skrip bisa mengulang
      // sampai 1.048.576 kali. Token membuktikan sid benar-benar keluar dari /create.
      // shortcut: kapabilitas sekali-pakai ini ikut di query string (browser tidak bisa
      // mengirim header WS). Cabut kalau nanti pindah ke WebSocket over fetch/headers.
      const tok = url.searchParams.get('tok') ?? '';
      if (!(await verifySessionToken(sid, tok, env))) {
        return json({ error: 'NO_TOKEN' }, 403);
      }
      return env.SESSION.get(env.SESSION.idFromName(sid)).fetch(request);
    }

    const aset = await env.ASSETS.fetch(request);
    // SPA fallback menjawab `/assets/*` yang tidak dikenal dengan index.html 200 → layar putih
    // (module-MIME error) tanpa gejala lain. Aset yang hilang harus 404, bukan HTML.
    if (url.pathname.startsWith('/assets/') && (aset.headers.get('content-type') ?? '').startsWith('text/html')) {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return aset;
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
