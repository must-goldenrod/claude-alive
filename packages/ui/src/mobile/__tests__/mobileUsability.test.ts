import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatStamp, formatStampShort } from '../time.ts';
import { fitGrid, fitFontSize, MIN_FIT_COLS, MIN_FIT_ROWS, MIN_FONT_PX } from '../MobileXterm.tsx';
import { mergeSessions } from '../mobileSessionMerge.ts';
import { loadRecentProjects, rememberProject, MAX_RECENT } from '../recentProjects.ts';
import { loadPresets, savePresets, autoStartCommand, DEFAULT_PRESETS } from '../terminalPresets.ts';
import type { MobileSession } from '../MobileSessionList.tsx';

/** jsdom's storage is not reliably present here, so the tests own one. */
function installStorage() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  vi.stubGlobal('window', { ...(globalThis.window ?? {}), localStorage: store });
  return store;
}

describe('formatStamp', () => {
  it('prints the wall clock a person can compare by eye', () => {
    expect(formatStamp(new Date(2026, 8, 22, 9, 5).getTime())).toBe('2026-09-22 09:05');
  });

  it('is empty rather than "1970-01-01" for a missing timestamp', () => {
    expect(formatStamp(0)).toBe('');
    expect(formatStamp(undefined)).toBe('');
    expect(formatStamp(null)).toBe('');
    expect(formatStamp(Number.NaN)).toBe('');
  });

  it('drops the date only for today', () => {
    const now = new Date(2026, 8, 22, 18, 0).getTime();
    expect(formatStampShort(new Date(2026, 8, 22, 9, 5).getTime(), now)).toBe('09:05');
    expect(formatStampShort(new Date(2026, 8, 21, 9, 5).getTime(), now)).toBe('2026-09-21 09:05');
  });
});

describe('terminal fitting', () => {
  it('fills the pane with a grid when the phone owns the pty', () => {
    expect(fitGrid(390, 600, 8, 20)).toEqual({ cols: 48, rows: 30 });
  });

  it('never collapses below a usable grid', () => {
    expect(fitGrid(40, 40, 8, 20)).toEqual({ cols: MIN_FIT_COLS, rows: MIN_FIT_ROWS });
  });

  it('falls back to a standard grid when nothing can be measured', () => {
    expect(fitGrid(0, 0, 8, 20)).toEqual({ cols: 80, rows: 24 });
  });

  it('shrinks the font instead when the grid belongs to someone else', () => {
    // 390px across 80 columns is unreadable, so it stops at the floor and pans.
    expect(fitFontSize(390, 200, 0.6, 14)).toBe(MIN_FONT_PX);
    expect(fitFontSize(390, 40, 0.6, 14)).toBe(14);
  });
});

describe('mergeSessions', () => {
  const catalog: MobileSession[] = [
    {
      sessionId: 's1', providerSessionId: 'p1', displayName: 'fix the thing',
      state: 'running', cwd: '/work/app', lastActivityAt: 100, needsApproval: false,
    },
    {
      sessionId: 's2', displayName: 'old one',
      state: 'idle', cwd: '/work/site', lastActivityAt: 50, needsApproval: false,
    },
  ];

  it('gives a catalog row the tab another device opened', () => {
    const [first] = mergeSessions(catalog, [
      { tabId: 'tab-a', claudeSessionId: 'p1', origin: 'desktop', live: true, lastActivityAt: 300 },
    ]);
    expect(first?.tabId).toBe('tab-a');
    expect(first?.origin).toBe('desktop');
    expect(first?.terminalLive).toBe(true);
    // The pty is the fresher fact about the same session.
    expect(first?.lastActivityAt).toBe(300);
  });

  it('shows a pty the catalog has never heard of', () => {
    const rows = mergeSessions(catalog, [
      { tabId: 'tab-shell', cwd: '/work/other', origin: 'mobile', live: true, lastActivityAt: 900 },
    ]);
    const extra = rows.find((r) => r.sessionId === 'tab-shell');
    expect(extra?.cwd).toBe('/work/other');
    expect(extra?.origin).toBe('mobile');
  });

  it('does not show one session twice', () => {
    const rows = mergeSessions(catalog, [
      { tabId: 'tab-a', claudeSessionId: 'p1', live: true, lastActivityAt: 300 },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('marks a dead pty so the list can call it ended', () => {
    const rows = mergeSessions([], [{ tabId: 'tab-x', live: false, lastActivityAt: 10 }]);
    expect(rows[0]?.terminalLive).toBe(false);
    expect(rows[0]?.state).toBe('exited');
  });
});

describe('recent folders', () => {
  beforeEach(() => { installStorage(); });

  it('remembers what was chosen, newest first', () => {
    rememberProject({ path: '/a', name: 'a' }, 1);
    rememberProject({ path: '/b', name: 'b' }, 2);
    expect(loadRecentProjects().map((r) => r.path)).toEqual(['/b', '/a']);
  });

  it('moves a re-used folder back to the top instead of duplicating it', () => {
    rememberProject({ path: '/a', name: 'a' }, 1);
    rememberProject({ path: '/b', name: 'b' }, 2);
    rememberProject({ path: '/a', name: 'a' }, 3);
    expect(loadRecentProjects().map((r) => r.path)).toEqual(['/a', '/b']);
  });

  it('keeps the list short enough to stay above the folder picker', () => {
    for (let i = 0; i < MAX_RECENT + 5; i += 1) rememberProject({ path: `/p${i}`, name: `p${i}` }, i);
    expect(loadRecentProjects()).toHaveLength(MAX_RECENT);
  });

  it('survives a corrupted or unreadable store', () => {
    window.localStorage.setItem('claude-alive.mobile.recentCwd', 'not json');
    expect(loadRecentProjects()).toEqual([]);
  });
});

describe('terminal presets', () => {
  beforeEach(() => { installStorage(); });

  it('seeds the command this feature exists for', () => {
    expect(autoStartCommand()).toBe('claude --dangerously-skip-permissions');
    expect(loadPresets()[0]?.id).toBe(DEFAULT_PRESETS[0]!.id);
  });

  it('keeps an edited list, including a deliberately empty one', () => {
    savePresets([{ id: 'x', label: 'x', command: 'echo x' }]);
    expect(loadPresets()).toEqual([{ id: 'x', label: 'x', command: 'echo x' }]);
    savePresets([]);
    expect(loadPresets()).toEqual([]);
  });

  it('falls back to the seed when the store is unreadable', () => {
    window.localStorage.setItem('claude-alive.mobile.termPresets', '{{');
    expect(loadPresets()).toEqual([...DEFAULT_PRESETS]);
  });
});
