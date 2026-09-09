import { describe, it, expect } from 'vitest';
import {
  parseRemoteTerminalLevel,
  remoteWsMessageAllowed,
  remoteWatchRoutes,
  REMOTE_TERMINAL_LEVELS,
} from '../remoteTerminal.js';

describe('parseRemoteTerminalLevel', () => {
  it('is off unless asked for — the safe default survives a typo', () => {
    for (const value of [undefined, '', 'off', 'nonsense', '1', 'true']) {
      expect(parseRemoteTerminalLevel(value), String(value)).toBe('off');
    }
  });
  it('reads the three levels, case-insensitively', () => {
    expect(parseRemoteTerminalLevel('watch')).toBe('watch');
    expect(parseRemoteTerminalLevel('INPUT')).toBe('input');
    expect(parseRemoteTerminalLevel(' shell ')).toBe('shell');
  });
  it('orders them from least to most capable', () => {
    expect(REMOTE_TERMINAL_LEVELS).toEqual(['off', 'watch', 'input', 'shell']);
  });
});

describe('remoteWsMessageAllowed', () => {
  const cases: Array<[string, Record<string, boolean>]> = [
    ['ping', { off: true, watch: true, input: true, shell: true }],
    ['request:snapshot', { off: true, watch: true, input: true, shell: true }],
    // Attaching only subscribes to output — it cannot type.
    ['terminal:attach', { off: false, watch: true, input: true, shell: true }],
    ['terminal:input', { off: false, watch: false, input: true, shell: true }],
    ['terminal:resize', { off: false, watch: false, input: true, shell: true }],
    // Spawning starts a new process; closing kills someone else's.
    ['terminal:spawn', { off: false, watch: false, input: false, shell: true }],
    ['terminal:close', { off: false, watch: false, input: false, shell: true }],
  ];

  for (const [type, expectations] of cases) {
    it(`gates ${type} by level`, () => {
      for (const [level, allowed] of Object.entries(expectations)) {
        expect(remoteWsMessageAllowed(type, level as never), `${type}@${level}`).toBe(allowed);
      }
    });
  }

  it('refuses an unknown message type at every level', () => {
    for (const level of REMOTE_TERMINAL_LEVELS) {
      expect(remoteWsMessageAllowed('terminal:evil', level)).toBe(false);
    }
  });
});

describe('remoteWatchRoutes', () => {
  it('adds nothing while watching is off', () => {
    expect(remoteWatchRoutes('off')).toEqual([]);
  });
  it('opens the read-only session surface from watch upward', () => {
    for (const level of ['watch', 'input', 'shell'] as const) {
      const paths = remoteWatchRoutes(level).map((r) => r.pattern.source);
      expect(paths.some((p) => p.includes('workspace-tree')), level).toBe(true);
      expect(paths.some((p) => p.includes('conversation')), level).toBe(true);
      expect(remoteWatchRoutes(level).every((r) => r.method === 'GET'), level).toBe(true);
    }
  });
});
