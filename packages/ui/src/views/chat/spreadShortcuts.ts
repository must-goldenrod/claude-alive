/**
 * Single source of truth for Spread View keyboard shortcuts.
 *
 * Both the key handler and the hover hints read this registry, so what a tile
 * advertises always matches what actually fires. Matching is on `code`
 * (KeyboardEvent.code — the physical key) rather than `key`, because on macOS
 * Alt+letter emits a special character in `key` (Alt+M → "µ") which would break
 * matching; `code` is layout- and modifier-independent.
 *
 * All chords are Alt(⌥)-based: Cmd/Ctrl-only combos are reserved by the browser
 * or OS and can't be reliably prevented, whereas Alt chords intercepted in the
 * capture phase are stopped before both xterm and the browser act on them.
 */

export type SpreadShortcutId =
  | 'focus-left'
  | 'focus-right'
  | 'focus-up'
  | 'focus-down'
  | 'swap-left'
  | 'swap-right'
  | 'swap-up'
  | 'swap-down'
  | 'grow-width'
  | 'shrink-width'
  | 'grow-height'
  | 'shrink-height'
  | 'maximize'
  | 'reset-layout';

export interface SpreadShortcut {
  id: SpreadShortcutId;
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  /** KeyboardEvent.code, e.g. 'ArrowLeft', 'KeyM', 'Digit0'. */
  code: string;
  /** i18n key for the action label. */
  labelKey: string;
}

const A = { alt: true, shift: false, ctrl: false, meta: false };

export const SPREAD_SHORTCUTS: SpreadShortcut[] = [
  { id: 'focus-left', ...A, code: 'ArrowLeft', labelKey: 'spread.shortcut.focusLeft' },
  { id: 'focus-right', ...A, code: 'ArrowRight', labelKey: 'spread.shortcut.focusRight' },
  { id: 'focus-up', ...A, code: 'ArrowUp', labelKey: 'spread.shortcut.focusUp' },
  { id: 'focus-down', ...A, code: 'ArrowDown', labelKey: 'spread.shortcut.focusDown' },
  { id: 'swap-left', ...A, shift: true, code: 'ArrowLeft', labelKey: 'spread.shortcut.swapLeft' },
  { id: 'swap-right', ...A, shift: true, code: 'ArrowRight', labelKey: 'spread.shortcut.swapRight' },
  { id: 'swap-up', ...A, shift: true, code: 'ArrowUp', labelKey: 'spread.shortcut.swapUp' },
  { id: 'swap-down', ...A, shift: true, code: 'ArrowDown', labelKey: 'spread.shortcut.swapDown' },
  { id: 'shrink-width', ...A, ctrl: true, code: 'ArrowLeft', labelKey: 'spread.shortcut.shrinkWidth' },
  { id: 'grow-width', ...A, ctrl: true, code: 'ArrowRight', labelKey: 'spread.shortcut.growWidth' },
  { id: 'shrink-height', ...A, ctrl: true, code: 'ArrowUp', labelKey: 'spread.shortcut.shrinkHeight' },
  { id: 'grow-height', ...A, ctrl: true, code: 'ArrowDown', labelKey: 'spread.shortcut.growHeight' },
  { id: 'maximize', ...A, code: 'KeyM', labelKey: 'spread.shortcut.maximize' },
  { id: 'reset-layout', ...A, code: 'Digit0', labelKey: 'spread.shortcut.resetLayout' },
];

/** Canonical string for a chord — used for duplicate detection. */
export function comboString(s: {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  code: string;
}): string {
  return `${s.meta ? 'M' : ''}${s.ctrl ? 'C' : ''}${s.alt ? 'A' : ''}${s.shift ? 'S' : ''}:${s.code}`;
}

/**
 * Guard against two shortcuts sharing a chord. Throws during development so a
 * collision is caught immediately; in production it degrades to console.error
 * so a packaging slip never crashes the app.
 */
export function assertUniqueShortcuts(shortcuts: SpreadShortcut[] = SPREAD_SHORTCUTS): void {
  const seen = new Map<string, SpreadShortcutId>();
  for (const s of shortcuts) {
    const combo = comboString(s);
    const prev = seen.get(combo);
    if (prev) {
      const msg = `[spread] duplicate shortcut chord ${combo}: ${prev} vs ${s.id}`;
      if (import.meta.env?.DEV) throw new Error(msg);
      console.error(msg);
      continue;
    }
    seen.set(combo, s.id);
  }
}

/** The shortcut matching this keydown event, or null. */
export function matchShortcut(
  e: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'>,
  shortcuts: SpreadShortcut[] = SPREAD_SHORTCUTS,
): SpreadShortcut | null {
  return (
    shortcuts.find(
      (s) =>
        s.alt === e.altKey &&
        s.shift === e.shiftKey &&
        s.ctrl === e.ctrlKey &&
        s.meta === e.metaKey &&
        s.code === e.code,
    ) ?? null
  );
}

const CODE_SYMBOL: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** Human-readable chord for hints/tooltips, e.g. "⌥⇧←", "⌥M". */
export function formatShortcut(s: {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  code: string;
}): string {
  let out = '';
  if (s.meta) out += '⌘';
  if (s.ctrl) out += '⌃';
  if (s.alt) out += '⌥';
  if (s.shift) out += '⇧';
  const sym =
    CODE_SYMBOL[s.code] ??
    (s.code.startsWith('Key')
      ? s.code.slice(3)
      : s.code.startsWith('Digit')
        ? s.code.slice(5)
        : s.code);
  return out + sym;
}
