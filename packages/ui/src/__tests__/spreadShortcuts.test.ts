import { describe, it, expect } from 'vitest';
import {
  SPREAD_SHORTCUTS,
  assertUniqueShortcuts,
  matchShortcut,
  formatShortcut,
  comboString,
} from '../views/chat/spreadShortcuts';

describe('SPREAD_SHORTCUTS registry', () => {
  it('has no duplicate chords', () => {
    expect(() => assertUniqueShortcuts()).not.toThrow();
    const combos = SPREAD_SHORTCUTS.map(comboString);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('assertUniqueShortcuts throws (in DEV) on a collision', () => {
    const dup = [SPREAD_SHORTCUTS[0]!, { ...SPREAD_SHORTCUTS[0]!, id: 'maximize' as const }];
    // vitest sets import.meta.env.DEV true.
    expect(() => assertUniqueShortcuts(dup)).toThrow(/duplicate shortcut chord/);
  });

  it('every shortcut is Alt-based (never a bare Ctrl/Cmd chord)', () => {
    for (const s of SPREAD_SHORTCUTS) expect(s.alt).toBe(true);
  });
});

describe('matchShortcut', () => {
  const ev = (o: Partial<KeyboardEvent>): KeyboardEvent =>
    ({ altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, code: '', ...o } as KeyboardEvent);

  it('matches focus (Alt+Arrow)', () => {
    expect(matchShortcut(ev({ altKey: true, code: 'ArrowLeft' }))?.id).toBe('focus-left');
  });
  it('matches swap (Alt+Shift+Arrow) distinctly from focus', () => {
    expect(matchShortcut(ev({ altKey: true, shiftKey: true, code: 'ArrowRight' }))?.id).toBe(
      'swap-right',
    );
  });
  it('matches resize (Alt+Ctrl+Arrow)', () => {
    expect(matchShortcut(ev({ altKey: true, ctrlKey: true, code: 'ArrowRight' }))?.id).toBe(
      'grow-width',
    );
  });
  it('matches maximize/reset', () => {
    expect(matchShortcut(ev({ altKey: true, code: 'KeyM' }))?.id).toBe('maximize');
    expect(matchShortcut(ev({ altKey: true, code: 'Digit0' }))?.id).toBe('reset-layout');
  });
  it('does not match without the Alt modifier', () => {
    expect(matchShortcut(ev({ code: 'ArrowLeft' }))).toBeNull();
  });
  it('does not match a plain letter typed into a terminal', () => {
    expect(matchShortcut(ev({ code: 'KeyM' }))).toBeNull();
  });
});

describe('formatShortcut', () => {
  it('renders modifier + key symbols', () => {
    expect(formatShortcut(SPREAD_SHORTCUTS.find((s) => s.id === 'focus-left')!)).toBe('⌥←');
    expect(formatShortcut(SPREAD_SHORTCUTS.find((s) => s.id === 'swap-right')!)).toBe('⌥⇧→');
    // Apple modifier order is Control, Option, Shift, Command → ⌃⌥.
    expect(formatShortcut(SPREAD_SHORTCUTS.find((s) => s.id === 'grow-width')!)).toBe('⌃⌥→');
    expect(formatShortcut(SPREAD_SHORTCUTS.find((s) => s.id === 'maximize')!)).toBe('⌥M');
    expect(formatShortcut(SPREAD_SHORTCUTS.find((s) => s.id === 'reset-layout')!)).toBe('⌥0');
  });
});
