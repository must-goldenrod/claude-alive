// Minimal ULID: Crockford base32, 48-bit ms timestamp + 80-bit randomness.
// Not the full spec (monotonic within ms), but sufficient for row IDs.
import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length;

function encodeTime(now: number, len: number): string {
  let n = now;
  let out = '';
  for (let i = 0; i < len; i++) {
    const mod = n % ENCODING_LEN;
    out = ENCODING[mod] + out;
    n = (n - mod) / ENCODING_LEN;
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ENCODING[bytes[i]! % ENCODING_LEN];
  }
  return out;
}

export function ulid(now = Date.now()): string {
  return encodeTime(now, 10) + encodeRandom(16);
}
