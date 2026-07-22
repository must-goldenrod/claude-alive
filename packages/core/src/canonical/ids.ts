/**
 * ULID generation (spec §I.4).
 *
 * Alive-internal IDs are ULIDs: 26 Crockford base32 chars, the first 10 encoding
 * a 48-bit millisecond timestamp (so ids sort lexicographically by creation time)
 * and the last 16 encoding 80 bits of randomness. Provider-native ids are stored
 * separately as `providerSessionId`.
 */

// Crockford base32, excluding I, L, O, U.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length; // 32
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const TOTAL_LEN = TIME_LEN + RANDOM_LEN; // 26
const MAX_TIME = 2 ** 48 - 1;

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export interface UlidClockOptions {
  /** Millisecond clock; defaults to Date.now. */
  now?: () => number;
  /** Returns a float in [0, 1); defaults to a crypto-backed source. */
  random?: () => number;
}

export type UlidFactory = () => string;

function encodeTime(time: number): string {
  if (!Number.isFinite(time) || time < 0 || time > MAX_TIME) {
    throw new RangeError(`ULID timestamp out of range: ${time}`);
  }
  let t = Math.floor(time);
  let out = '';
  for (let i = 0; i < TIME_LEN; i++) {
    out = ENCODING[t % ENCODING_LEN] + out;
    t = Math.floor(t / ENCODING_LEN);
  }
  return out;
}

function encodeRandom(random: () => number): string {
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[Math.floor(random() * ENCODING_LEN) % ENCODING_LEN];
  }
  return out;
}

/**
 * Increment a Crockford base32 string by one, propagating carries. Returns
 * `null` on overflow (all symbols were the maximum) so the caller can carry into
 * the timestamp field rather than silently wrapping to a smaller value — which
 * would violate monotonicity.
 */
function incrementBase32(str: string): string | null {
  const chars = str.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ENCODING.indexOf(chars[i]);
    if (idx < ENCODING_LEN - 1) {
      chars[i] = ENCODING[idx + 1];
      return chars.join('');
    }
    chars[i] = ENCODING[0]; // carry
  }
  return null; // overflow
}

function defaultRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
}

/**
 * Build a ULID factory with an injectable clock and RNG. Guarantees strict
 * lexicographic monotonicity even for multiple ids minted in the same millisecond.
 */
export function createUlidFactory(options: UlidClockOptions = {}): UlidFactory {
  const now = options.now ?? Date.now;
  const random = options.random ?? defaultRandom;

  let lastTime = -1;
  let lastRandom = '';

  return function next(): string {
    const clock = Math.floor(now());
    let time: number;
    if (clock > lastTime) {
      // Clock advanced: fresh randomness. The larger time field alone already
      // makes this id sort after every prior one.
      time = clock;
      lastRandom = encodeRandom(random);
    } else {
      // Clock stalled within a millisecond, or ran backwards. Keep advancing the
      // random field; on overflow, carry into the timestamp so ids stay strictly
      // increasing (decodeUlidTime may then read slightly ahead of the wall clock).
      time = lastTime;
      const incremented = incrementBase32(lastRandom);
      if (incremented === null) {
        time = lastTime + 1;
        lastRandom = ENCODING[0].repeat(RANDOM_LEN);
      } else {
        lastRandom = incremented;
      }
    }
    lastTime = time;
    return encodeTime(time) + lastRandom;
  };
}

/** Default process-wide ULID generator (Date.now + crypto). */
export const ulid: UlidFactory = createUlidFactory();

export function isUlid(value: string): boolean {
  if (value.length !== TOTAL_LEN || !ULID_RE.test(value)) return false;
  // A 48-bit timestamp over 10 base32 chars caps the leading symbol at 7
  // (32^9 * 8 > 2^48); anything higher encodes an out-of-range timestamp.
  return ENCODING.indexOf(value[0]) <= 7;
}

export function decodeUlidTime(id: string): number {
  if (!isUlid(id)) throw new TypeError(`Not a ULID: ${id}`);
  let time = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    time = time * ENCODING_LEN + ENCODING.indexOf(id[i]);
  }
  return time;
}
