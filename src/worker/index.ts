import { genSid, isSid } from '../shared/ids';
import { leaderKey, sessionToken, verifySessionToken } from './keys';
import { SessionDO } from './SessionDO';

export { SessionDO };

const IP = 'CF-Connecting-IP';

// Tanpa kunci, token apa pun yang kami mint bisa dihitung ulang oleh siapa pun, jadi dua rute
// di bawah harus menolak, bukan melayani sesi yang gerbangnya tidak ada.
function noKey(env: Env): Response | null {
  return (env.SESSION_SIGNING_KEY ?? '').length === 0 ? json({ error: 'NO_KEY' }, 500) : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
