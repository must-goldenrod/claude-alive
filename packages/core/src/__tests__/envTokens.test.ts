import { describe, it, expect } from 'vitest';
import { addDeviceToken, listDeviceTokens, revokeDeviceToken, readEnvValue } from '../env/tokens.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

describe('readEnvValue', () => {
  it('reads a key, tolerating export and quotes', () => {
    expect(readEnvValue('export CLAUDE_ALIVE_LOCAL_TOKEN="abc"\n', 'CLAUDE_ALIVE_LOCAL_TOKEN')).toBe('abc');
  });
  it('returns undefined for a missing key', () => {
    expect(readEnvValue('OTHER=1\n', 'CLAUDE_ALIVE_LOCAL_TOKEN')).toBeUndefined();
  });
  it('ignores a commented-out line', () => {
    expect(readEnvValue('#CLAUDE_ALIVE_TOKENS=x\n', 'CLAUDE_ALIVE_TOKENS')).toBeUndefined();
  });
});

describe('device token list', () => {
  it('adds the first token', () => {
    const next = addDeviceToken('', 'phone', A);
    expect(next).toContain(`CLAUDE_ALIVE_TOKENS=phone:${A}`);
    expect(listDeviceTokens(next)).toEqual([{ label: 'phone', value: A }]);
  });

  it('appends without disturbing other keys', () => {
    const start = 'LITELLM_KEY=secret\n';
    const next = addDeviceToken(start, 'phone', A);
    expect(next).toContain('LITELLM_KEY=secret');
    expect(listDeviceTokens(next)).toHaveLength(1);
  });

  it('keeps earlier devices when a second is added', () => {
    const next = addDeviceToken(addDeviceToken('', 'phone', A), 'ipad', B);
    expect(listDeviceTokens(next)).toEqual([
      { label: 'phone', value: A },
      { label: 'ipad', value: B },
    ]);
  });

  it('replaces a label rather than issuing two tokens under one name', () => {
    const next = addDeviceToken(addDeviceToken('', 'phone', A), 'phone', B);
    expect(listDeviceTokens(next)).toEqual([{ label: 'phone', value: B }]);
  });

  it('revokes one device and leaves the rest', () => {
    const two = addDeviceToken(addDeviceToken('', 'phone', A), 'ipad', B);
    const next = revokeDeviceToken(two, 'phone');
    expect(listDeviceTokens(next)).toEqual([{ label: 'ipad', value: B }]);
  });

  it('drops the variable entirely when the last device is revoked', () => {
    const one = addDeviceToken('LITELLM_KEY=secret\n', 'phone', A);
    const next = revokeDeviceToken(one, 'phone');
    expect(next).toBe('LITELLM_KEY=secret\n');
  });

  it('leaves the file untouched when the label is unknown', () => {
    const one = addDeviceToken('', 'phone', A);
    expect(revokeDeviceToken(one, 'nope')).toBe(one);
  });

  it('rejects a label that would break the file format', () => {
    expect(() => addDeviceToken('', 'bad:label', A)).toThrow();
    expect(() => addDeviceToken('', 'bad,label', A)).toThrow();
    expect(() => addDeviceToken('', '', A)).toThrow();
  });
});
