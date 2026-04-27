import { useEffect, useState } from 'react';

/**
 * App-wide user settings.
 *
 * Persisted to localStorage, exposed via a module-level singleton so non-React
 * code (sound playback) and React components alike can read the current values.
 * Updates fan out to subscribers via a small event-emitter.
 */

// ── Theme presets ──────────────────────────────────────────────────────────

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalThemePreset {
  id: string;
  label: string;
  theme: TerminalTheme;
}

export const TERMINAL_THEMES: TerminalThemePreset[] = [
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: 'rgba(88, 166, 255, 0.3)',
      black: '#0d1117', red: '#ff7b72', green: '#7ee787', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#c9d1d9',
      brightBlack: '#484f58', brightRed: '#ffa198', brightGreen: '#7ee787', brightYellow: '#e3b341',
      brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d364', brightWhite: '#f0f6fc',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: 'rgba(68, 71, 90, 0.99)',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
      brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    theme: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(54, 58, 79, 0.99)',
      black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
      blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
      brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
      brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    theme: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: 'rgba(73, 72, 62, 0.99)',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
      blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
      brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
      brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
    },
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    theme: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: 'rgba(62, 68, 81, 0.99)',
      black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
      brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    theme: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: 'rgba(67, 76, 94, 0.99)',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: 'rgba(7, 54, 66, 0.99)',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    theme: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      cursorAccent: '#282828',
      selectionBackground: 'rgba(60, 56, 54, 0.99)',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
      blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f',
      brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
    },
  },
  {
    id: 'transparent',
    label: 'Transparent (legacy)',
    theme: {
      background: 'transparent',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: 'rgba(88, 166, 255, 0.3)',
      black: '#0d1117', red: '#ff7b72', green: '#7ee787', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#c9d1d9',
      brightBlack: '#484f58', brightRed: '#ffa198', brightGreen: '#7ee787', brightYellow: '#e3b341',
      brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d364', brightWhite: '#f0f6fc',
    },
  },
];

export function getThemeById(id: string): TerminalTheme {
  return (TERMINAL_THEMES.find(t => t.id === id) ?? TERMINAL_THEMES[0]!).theme;
}

// ── Font presets ───────────────────────────────────────────────────────────

export interface FontPreset {
  id: string;
  label: string;
  family: string;
}

export const FONT_PRESETS: FontPreset[] = [
  { id: 'sf-mono', label: 'SF Mono (system)', family: 'SF Mono, Monaco, Menlo, monospace' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: '"JetBrains Mono", monospace' },
  { id: 'fira-code', label: 'Fira Code', family: '"Fira Code", monospace' },
  { id: 'cascadia-code', label: 'Cascadia Code', family: '"Cascadia Code", monospace' },
  { id: 'source-code-pro', label: 'Source Code Pro', family: '"Source Code Pro", monospace' },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace' },
  { id: 'menlo', label: 'Menlo', family: 'Menlo, monospace' },
  { id: 'monaco', label: 'Monaco', family: 'Monaco, monospace' },
];

export function getFontFamily(id: string): string {
  return (FONT_PRESETS.find(f => f.id === id) ?? FONT_PRESETS[0]!).family;
}

// ── Settings shape ─────────────────────────────────────────────────────────

export type CursorStyle = 'block' | 'bar' | 'underline';

export interface AppSettings {
  sound: {
    completion: { enabled: boolean; volume: number };
    error: { enabled: boolean; volume: number };
  };
  terminal: {
    themeId: string;
    fontFamilyId: string;
    fontSize: number;       // 10..22
    lineHeight: number;     // 1.0..2.0
    letterSpacing: number;  // -2..4 px
    cursorStyle: CursorStyle;
    cursorBlink: boolean;
    cursorWidth: number;    // 1..4 (only used when cursorStyle === 'bar')
    paddingX: number;       // 0..32
    paddingY: number;       // 0..32
    scrollback: number;     // 1000..50000
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  sound: {
    completion: { enabled: true, volume: 0.7 },
    error: { enabled: true, volume: 0.7 },
  },
  terminal: {
    themeId: 'github-dark',
    fontFamilyId: 'sf-mono',
    fontSize: 13,
    lineHeight: 1.4,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    cursorWidth: 1,
    paddingX: 12,
    paddingY: 8,
    scrollback: 5000,
  },
};

// ── Persistence ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'claude-alive:settings:v1';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitize(raw: unknown): AppSettings {
  // Defensive merge: any malformed/missing field falls back to default. This means
  // we can grow the settings shape over time without bumping the storage version.
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppSettings>;
  const sound = (obj.sound ?? {}) as Partial<AppSettings['sound']>;
  const term = (obj.terminal ?? {}) as Partial<AppSettings['terminal']>;
  return {
    sound: {
      completion: {
        enabled: typeof sound.completion?.enabled === 'boolean' ? sound.completion.enabled : DEFAULT_SETTINGS.sound.completion.enabled,
        volume: clamp(Number(sound.completion?.volume ?? DEFAULT_SETTINGS.sound.completion.volume), 0, 1),
      },
      error: {
        enabled: typeof sound.error?.enabled === 'boolean' ? sound.error.enabled : DEFAULT_SETTINGS.sound.error.enabled,
        volume: clamp(Number(sound.error?.volume ?? DEFAULT_SETTINGS.sound.error.volume), 0, 1),
      },
    },
    terminal: {
      themeId: typeof term.themeId === 'string' ? term.themeId : DEFAULT_SETTINGS.terminal.themeId,
      fontFamilyId: typeof term.fontFamilyId === 'string' ? term.fontFamilyId : DEFAULT_SETTINGS.terminal.fontFamilyId,
      fontSize: clamp(Number(term.fontSize ?? DEFAULT_SETTINGS.terminal.fontSize), 10, 22),
      lineHeight: clamp(Number(term.lineHeight ?? DEFAULT_SETTINGS.terminal.lineHeight), 1.0, 2.0),
      letterSpacing: clamp(Number(term.letterSpacing ?? DEFAULT_SETTINGS.terminal.letterSpacing), -2, 4),
      cursorStyle: (['block', 'bar', 'underline'] as const).includes(term.cursorStyle as CursorStyle)
        ? (term.cursorStyle as CursorStyle)
        : DEFAULT_SETTINGS.terminal.cursorStyle,
      cursorBlink: typeof term.cursorBlink === 'boolean' ? term.cursorBlink : DEFAULT_SETTINGS.terminal.cursorBlink,
      cursorWidth: clamp(Number(term.cursorWidth ?? DEFAULT_SETTINGS.terminal.cursorWidth), 1, 4),
      paddingX: clamp(Number(term.paddingX ?? DEFAULT_SETTINGS.terminal.paddingX), 0, 32),
      paddingY: clamp(Number(term.paddingY ?? DEFAULT_SETTINGS.terminal.paddingY), 0, 32),
      scrollback: clamp(Number(term.scrollback ?? DEFAULT_SETTINGS.terminal.scrollback), 1000, 50000),
    },
  };
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded / private mode — ignore silently.
  }
}

// ── Module-level singleton + subscribe pattern ─────────────────────────────

let current: AppSettings = load();
const listeners = new Set<(s: AppSettings) => void>();

export function getSettings(): AppSettings {
  return current;
}

export function setSettings(updater: (prev: AppSettings) => AppSettings): void {
  const next = sanitize(updater(current));
  current = next;
  save(next);
  for (const fn of listeners) fn(next);
}

export function subscribeSettings(fn: (s: AppSettings) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── React hook ─────────────────────────────────────────────────────────────

export function useSettings(): AppSettings {
  const [snapshot, setSnapshot] = useState<AppSettings>(current);
  useEffect(() => {
    return subscribeSettings(setSnapshot);
  }, []);
  return snapshot;
}
