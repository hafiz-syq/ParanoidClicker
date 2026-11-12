export const MAX_FRAME_BYTES = 8 * 1024;
export const MAX_JSON_DEPTH = 4;
export const MAX_STRING_LEN = 256;
export const MAX_ARRAY_LEN = 256;
export const MAX_MEMBERS = 12;

export type FrameCode = 'TOO_BIG' | 'TOO_DEEP' | 'BAD_KEY' | 'BAD_TYPE';

export class FrameReject extends Error {
  constructor(readonly code: FrameCode, message: string) {
    super(message);
    this.name = 'FrameReject';
  }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Batas kedalaman harus diputuskan SEBELUM JSON.parse: parser itu sendiri
// kehabisan stack pada input 100k kurung buka, dan itu mematikan Worker.
export function maxNesting(text: string, limit = MAX_JSON_DEPTH): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') {
      if (++depth > max) {
        max = depth;
        if (max > limit) return max;
      }
    } else if (c === ']' || c === '}') depth--;
  }
  return max;
}

export function checkShape(value: unknown, depth = 1): void {
  if (depth > MAX_JSON_DEPTH) throw new FrameReject('TOO_DEEP', `nesting > ${MAX_JSON_DEPTH}`);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LEN) throw new FrameReject('TOO_BIG', `string > ${MAX_STRING_LEN}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LEN) throw new FrameReject('TOO_BIG', `array > ${MAX_ARRAY_LEN}`);
    for (const item of value) checkShape(item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) throw new FrameReject('BAD_KEY', key);
      checkShape(item, depth + 1);
    }
    return;
  }
  throw new FrameReject('BAD_TYPE', typeof value);
}

export function parseFrame(text: string): Record<string, unknown> {
  if (text.length > MAX_FRAME_BYTES) throw new FrameReject('TOO_BIG', `frame > ${MAX_FRAME_BYTES}`);
  if (maxNesting(text) > MAX_JSON_DEPTH) throw new FrameReject('TOO_DEEP', 'frame too deeply nested');
  const value = JSON.parse(text) as unknown;
  checkShape(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FrameReject('BAD_TYPE', 'frame must be an object');
  }
  return value as Record<string, unknown>;
}
