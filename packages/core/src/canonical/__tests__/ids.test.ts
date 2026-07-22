import { describe, expect, test } from 'vitest';
import { createUlidFactory, decodeUlidTime, isUlid, ulid } from '../ids.js';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ulid()', () => {
  test('produces a 26-char Crockford base32 string', () => {
    const id = ulid();
    expect(id).toMatch(CROCKFORD);
  });

  test('two ids are distinct', () => {
    expect(ulid()).not.toBe(ulid());
  });
});

describe('createUlidFactory', () => {
  test('encodes the supplied timestamp so ids sort by time', () => {
    const early = createUlidFactory({ now: () => 1_000, random: () => 0 })();
    const late = createUlidFactory({ now: () => 2_000, random: () => 0 })();
    expect(late > early).toBe(true);
  });

  test('is monotonic within the same millisecond', () => {
    const factory = createUlidFactory({ now: () => 1_700_000_000_000, random: () => 0.5 });
    const a = factory();
    const b = factory();
    const c = factory();
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
  });

  test('decodeUlidTime round-trips the timestamp', () => {
    const ts = 1_700_000_000_123;
    const id = createUlidFactory({ now: () => ts, random: () => 0.25 })();
    expect(decodeUlidTime(id)).toBe(ts);
  });

  test('stays monotonic when the random suffix is maxed out (all Z)', () => {
    // random() === 0.9999 → every random char is the max symbol 'Z'
    const factory = createUlidFactory({ now: () => 1_700_000_000_000, random: () => 0.9999 });
    const a = factory();
    const b = factory(); // same ms, suffix would overflow ZZ…Z
    const c = factory();
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
  });

  test('stays monotonic when the clock runs backwards', () => {
    let t = 1_700_000_000_005;
    const factory = createUlidFactory({ now: () => t, random: () => 0.5 });
    const a = factory();
    t = 1_700_000_000_000; // clock jumped back 5ms
    const b = factory();
    expect(b > a).toBe(true);
  });
});

describe('isUlid', () => {
  test('accepts a generated id', () => {
    expect(isUlid(ulid())).toBe(true);
  });

  test('rejects wrong length and illegal characters', () => {
    expect(isUlid('too-short')).toBe(false);
    expect(isUlid('I'.repeat(26))).toBe(false); // I is not in Crockford base32
    expect(isUlid('')).toBe(false);
  });

  test('rejects a timestamp that exceeds 48 bits (first char above 7)', () => {
    // '8' as the leading char encodes a > 48-bit timestamp — not a valid ULID.
    expect(isUlid('8' + '0'.repeat(25))).toBe(false);
    expect(isUlid('7' + '0'.repeat(25))).toBe(true);
  });
});
