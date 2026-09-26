import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readView, writeView, usePersistedState, VIEW_KEY_PREFIX } from '../viewState.ts';

/** Node's experimental localStorage stub has no removeItem; inject a full one. */
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

const isTab = (v: unknown): v is 'a' | 'b' => v === 'a' || v === 'b';

beforeEach(() => vi.stubGlobal('localStorage', makeStorage()));

describe('viewState', () => {
  it('round-trips a value under the mobile prefix', () => {
    writeView('tab', 'b');
    expect(localStorage.getItem(`${VIEW_KEY_PREFIX}tab`)).toBe('"b"');
    expect(readView('tab', isTab)).toBe('b');
  });

  it('drops a stored value that no longer validates', () => {
    localStorage.setItem(`${VIEW_KEY_PREFIX}tab`, '"gone"');
    expect(readView('tab', isTab)).toBeUndefined();
  });

  it('survives a corrupted value', () => {
    localStorage.setItem(`${VIEW_KEY_PREFIX}tab`, '{not json');
    expect(readView('tab', isTab)).toBeUndefined();
  });

  it('removes the key when the value is cleared', () => {
    writeView('tab', 'a');
    writeView('tab', null);
    expect(localStorage.getItem(`${VIEW_KEY_PREFIX}tab`)).toBeNull();
  });

  it('starts from what was stored and writes every change back', () => {
    writeView('tab', 'b');
    const { result, unmount } = renderHook(() => usePersistedState('tab', 'a', isTab));
    expect(result.current[0]).toBe('b');
    act(() => result.current[1]('a'));
    unmount();
    const again = renderHook(() => usePersistedState('tab', 'b', isTab));
    expect(again.result.current[0]).toBe('a');
  });
});
