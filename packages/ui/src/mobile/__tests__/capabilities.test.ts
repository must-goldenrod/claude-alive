import { describe, it, expect } from 'vitest';
import { parseCapabilities } from '../capabilities.ts';

describe('parseCapabilities', () => {
  it('reads what the server reported', () => {
    expect(parseCapabilities({ terminal: 'shell', remote: true })).toEqual({ terminal: 'shell', remote: true });
  });
  it('falls back to off for anything it does not recognise', () => {
    for (const value of [undefined, null, {}, { terminal: 'root' }, 'nope']) {
      expect(parseCapabilities(value).terminal, JSON.stringify(value)).toBe('off');
    }
  });
});
