// Semua kapabilitas di aplikasi ini HMAC-SHA-256 atas sid dengan kunci ruangan yang sama:
// `tok` = HMAC(sid) dan `lk` = HMAC(sid + ":leader"). Keduanya dipakai dari dua tempat yang
// berbeda — Worker mencetak + memeriksa saat upgrade, DO memeriksa `lk` tiap perintah masuk —
// jadi SATU cache CryptoKey juga: kalau `wrangler secret put` diganti, kedua tempat harus
// berpindah ke kunci yang sama di isolate yang sama. Dua cache = satu sesi dengan dua kebenaran.
const enc = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/;

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

function parseHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (!HEX64.test(text)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmacHex(data: string, env: Env): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', await signingKey(env), enc.encode(data)));
}

// `crypto.subtle.verify` membandingkan MAC di dalam WebCrypto (bukan `===` di JS), jadi
// panjangnya tidak bocor lewat waktu perbandingan.
async function verifyHex(data: string, hex: string, env: Env): Promise<boolean> {
  const sig = parseHex(hex);
  if (!sig) return false;
  return crypto.subtle.verify('HMAC', await signingKey(env), sig, enc.encode(data));
}

/** Kapabilitas SESI: dipegang pemimpin DAN kesebelas pengikut, duduk di query string `/ws`. */
export function sessionToken(sid: string, env: Env): Promise<string> {
  return hmacHex(sid, env);
}

export function verifySessionToken(sid: string, tok: string, env: Env): Promise<boolean> {
  return verifyHex(sid, tok, env);
}

/**
 * Kapabilitas PEMIMPIN (`lk`): sid yang sama, ruang nama berbeda, hanya keluar dari JSON
 * `/create`. Tautan join / QR tidak pernah memuatnya, jadi yang dibagikan tetap cuma anggota.
 */
export function leaderKey(sid: string, env: Env): Promise<string> {
  return hmacHex(`${sid}:leader`, env);
}

export function verifyLeaderKey(sid: string, lk: string, env: Env): Promise<boolean> {
  return verifyHex(`${sid}:leader`, lk, env);
}
