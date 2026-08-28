import { describe, expect, it } from 'vitest';
import { isAllowedWsOrigin } from '../wsOrigin.js';

describe('isAllowedWsOrigin', () => {
  it('allows a request with no Origin — native clients send none', () => {
    expect(isAllowedWsOrigin(undefined, 3141)).toBe(true);
  });

  it('allows the dashboard served from loopback on its own port', () => {
    for (const origin of ['http://localhost:3141', 'http://127.0.0.1:3141', 'http://[::1]:3141']) {
      expect(isAllowedWsOrigin(origin, 3141)).toBe(true);
    }
  });

  it('allows the Vite dev server on loopback', () => {
    expect(isAllowedWsOrigin('http://localhost:5173', 3141)).toBe(true);
  });

  it('rejects any page served from another host', () => {
    for (const origin of ['https://evil.example', 'http://192.168.1.5:3141', 'http://attacker.localhost.evil.com']) {
      expect(isAllowedWsOrigin(origin, 3141)).toBe(false);
    }
  });

  it('rejects a malformed Origin rather than passing it through', () => {
    expect(isAllowedWsOrigin('not a url', 3141)).toBe(false);
    expect(isAllowedWsOrigin('', 3141)).toBe(false);
  });
});
