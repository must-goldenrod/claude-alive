import { describe, expect, test } from 'vitest';
import { resolveSessionTerminal } from '../sessionTerminalLink.js';

const deps = (over: Partial<Parameters<typeof resolveSessionTerminal>[1]> = {}) => ({
  findProviderRef: (id: string) =>
    id === 'ALIVE_1' ? { provider: 'claude', providerSessionId: 'claude-abc' } : undefined,
  findTabId: (claudeSessionId: string) => (claudeSessionId === 'claude-abc' ? 'tab-8' : undefined),
  isLive: (tabId: string) => tabId === 'tab-8',
  ...over,
});

describe('resolveSessionTerminal', () => {
  test('reports a live terminal for a UI-spawned session', () => {
    expect(resolveSessionTerminal('ALIVE_1', deps())).toEqual({
      available: true,
      live: true,
      tabId: 'tab-8',
    });
  });

  test('a known tab whose process has exited is available but not live', () => {
    const r = resolveSessionTerminal('ALIVE_1', deps({ isLive: () => false }));
    expect(r).toMatchObject({ available: true, live: false, tabId: 'tab-8' });
  });

  test('an external session Alive never spawned has no terminal, with a reason', () => {
    const r = resolveSessionTerminal('ALIVE_1', deps({ findTabId: () => undefined }));
    expect(r.available).toBe(false);
    expect(r.reason).toBe('not-spawned-by-alive');
  });

  test('an unknown session is reported as unknown, not as "no terminal"', () => {
    const r = resolveSessionTerminal('NOPE', deps());
    expect(r.available).toBe(false);
    expect(r.reason).toBe('unknown-session');
  });

  test('never throws when a lookup fails', () => {
    const r = resolveSessionTerminal(
      'ALIVE_1',
      deps({
        isLive: () => {
          throw new Error('terminal manager exploded');
        },
      }),
    );
    expect(r.available).toBe(false);
    expect(r.reason).toBe('lookup-failed');
  });
});
