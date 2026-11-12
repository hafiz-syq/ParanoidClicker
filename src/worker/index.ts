import { genSid, isSid } from '../shared/ids';
import { SessionDO } from './SessionDO';

export { SessionDO };

const IP = 'CF-Connecting-IP';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, proto: 1, keyLen: (env.SESSION_SIGNING_KEY ?? '').length });
    }

    if (url.pathname === '/create') {
      if (request.method !== 'POST') return json({ error: 'PROTO' }, 405);
      const { success } = await env.CREATE_LIMITER.limit({ key: request.headers.get(IP) ?? 'no-ip' });
      if (!success) return json({ error: 'RATE_LIMITED' }, 429);
      // Sengaja tidak menyentuh DO di sini: badai /create tidak boleh melahirkan DO kosong.
      const sid = genSid();
      return json({ sid, wsPath: `/ws?sid=${sid}` });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected Upgrade: websocket' }, 426);
      }
      const sid = url.searchParams.get('sid');
      if (!isSid(sid)) return json({ error: 'PROTO' }, 400);
      return env.SESSION.get(env.SESSION.idFromName(sid)).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
