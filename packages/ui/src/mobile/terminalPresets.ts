/**
 * Commands the phone can type for you.
 *
 * `claude --dangerously-skip-permissions` is 38 characters with two hyphens
 * and no autocomplete, and it is the first thing typed into almost every
 * session. On a soft keyboard that is the single most expensive interaction in
 * the app. One tap replaces it.
 *
 * Stored per device, seeded once, editable: the list is a personal habit, not
 * a product decision, and the seed is only the habit we already know about.
 */
const KEY = 'claude-alive.mobile.termPresets';

export interface TerminalPreset {
  id: string;
  label: string;
  /** Sent verbatim, followed by a carriage return. */
  command: string;
}

/** The command this feature exists for, plus the two that always follow it. */
export const DEFAULT_PRESETS: readonly TerminalPreset[] = [
  { id: 'claude-skip', label: 'claude (skip perms)', command: 'claude --dangerously-skip-permissions' },
  { id: 'claude-continue', label: 'claude -c', command: 'claude --continue --dangerously-skip-permissions' },
  { id: 'git-status', label: 'git status', command: 'git status --short --branch' },
];

function isPreset(value: unknown): value is TerminalPreset {
  const p = value as Partial<TerminalPreset> | null;
  return typeof p?.id === 'string' && typeof p.label === 'string' && typeof p.command === 'string';
}

export function loadPresets(): TerminalPreset[] {
  try {
    const raw = window.localStorage?.getItem(KEY);
    if (!raw) return [...DEFAULT_PRESETS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PRESETS];
    const presets = parsed.filter(isPreset);
    // An empty stored list is a deliberate "I want none", not a broken read.
    return presets.length > 0 || parsed.length === 0 ? presets : [...DEFAULT_PRESETS];
  } catch {
    return [...DEFAULT_PRESETS];
  }
}

export function savePresets(presets: readonly TerminalPreset[]): void {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(presets));
  } catch {
    /* the presets still work for this session without being remembered */
  }
}

/** The command a freshly spawned shell should run when auto-start is on. */
export function autoStartCommand(): string {
  return loadPresets()[0]?.command ?? DEFAULT_PRESETS[0]!.command;
}
