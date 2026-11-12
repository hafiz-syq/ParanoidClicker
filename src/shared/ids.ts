const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 32 simbol = pembagi 256 persis, jadi `n % 32` tidak membiaskan distribusi.
// Tanpa I/O/0/1 supaya terbaca di ruangan gelap.
export function genSid(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const n of bytes) out += ALPHABET[n % ALPHABET.length];
  return out;
}

export function isSid(value: unknown): value is string {
  return typeof value === 'string' && /^[A-HJ-NP-Z2-9]{4}$/.test(value);
}

const DIGITS = '0123456789';
// 256 % 10 != 0, jadi 250..255 dibuang supaya digit PIN seragam.
export function genPin(length = 6): string {
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (const n of bytes) if (n < 250) out += DIGITS[n % 10];
  }
  return out.slice(0, length);
}

export function genDid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
}
