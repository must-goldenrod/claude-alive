import { describe, it, expect, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
});

const { resolveAppearance } = await import('../services/appearance');
const { getSettings, setSettings } = await import('../services/settings');

describe('appearance', () => {
  it('resolves explicit modes and follows the OS for system', () => {
    expect(resolveAppearance('dark', true)).toBe('dark');
    expect(resolveAppearance('light', false)).toBe('light');
    expect(resolveAppearance('system', true)).toBe('light');
    expect(resolveAppearance('system', false)).toBe('dark');
  });

  it('defaults to dark and rejects unknown modes', () => {
    expect(getSettings().appearance.mode).toBe('dark');
    setSettings(prev => ({ ...prev, appearance: { mode: 'sepia' as never } }));
    expect(getSettings().appearance.mode).toBe('dark');
    setSettings(prev => ({ ...prev, appearance: { mode: 'light' } }));
    expect(getSettings().appearance.mode).toBe('light');
  });
});
