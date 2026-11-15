import { genSid, isSid } from '../shared/ids';
import { SessionDO } from './SessionDO';

export { SessionDO };

const IP = 'CF-Connecting-IP';
const enc = new TextEncoder();

// Memo per nilai kunci: `wrangler secret put` boleh diganti tanpa restart, dan kunci lama
// tidak pernah dipakai lagi setelah isolate berikutnya bangun.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function signingKey(env: Env): Promise<CryptoKey> {
  const secret = env.SESSION_SIGNING_KEY ?? '';
  // DataError dari WebCrypto ("key length 0") tidak menyebut apa pun yang bisa dibaca
  // operator di `wrangler tail`, jadi namanya yang kusebut.
  if (secret.length === 0) {
    throw new Error('SESSION_SIGNING_KEY kosong: isi .dev.vars (lokal) atau `npm run secret` (produksi)');
  }
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
      ]),
    };
  }
  return cachedKey.key;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createToken(sid: string, env: Env): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', await signingKey(env), enc.encode(sid)));
}

function parseHex(text: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(text)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

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
      const token = await createToken(sid, env);
      return json({ sid, token, wsPath: `/ws?sid=${sid}&tok=${token}` });
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
      const tok = parseHex(url.searchParams.get('tok') ?? '');
      if (!tok || !(await crypto.subtle.verify('HMAC', await signingKey(env), tok, enc.encode(sid)))) {
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
