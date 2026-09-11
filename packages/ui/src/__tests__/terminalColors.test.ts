import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node's localStorage stub lacks setItem/getItem semantics we rely on; inject a map.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
});

const { getSettings, setSettings, resolveTerminalTheme, getThemeById, TERMINAL_THEMES } =
  await import('../services/settings');

describe('terminal colours', () => {
  beforeEach(() => {
    setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, themeId: 'github-dark', colorOverrides: {} } }));
  });

  it('ships a light preset with white background and dark text', () => {
    const light = TERMINAL_THEMES.find(t => t.id === 'github-light');
    expect(light?.theme.background).toBe('#ffffff');
    expect(light?.theme.foreground).toBe('#1f2328');
  });

  it('returns the preset unchanged without overrides', () => {
    expect(resolveTerminalTheme('github-light', {})).toEqual(getThemeById('github-light'));
  });

  it('layers overrides and keeps the cursor accent on the background', () => {
    const theme = resolveTerminalTheme('github-dark', { background: '#ffffff', green: '#00aa00' });
    expect(theme.background).toBe('#ffffff');
    expect(theme.green).toBe('#00aa00');
    expect(theme.cursorAccent).toBe('#ffffff');
    expect(theme.red).toBe(getThemeById('github-dark').red);
  });

  it('drops invalid colours and unknown keys when saving', () => {
    setSettings(prev => ({
      ...prev,
      terminal: {
        ...prev.terminal,
        colorOverrides: { red: '#FF0000', green: 'lime', selectionBackground: '#123456' } as never,
      },
    }));
    expect(getSettings().terminal.colorOverrides).toEqual({ red: '#ff0000' });
  });

  it('defaults to empty overrides for settings saved before the field existed', () => {
    setSettings(prev => {
      const { colorOverrides: _drop, ...rest } = prev.terminal;
      return { ...prev, terminal: rest as typeof prev.terminal };
    });
    expect(getSettings().terminal.colorOverrides).toEqual({});
  });
});
