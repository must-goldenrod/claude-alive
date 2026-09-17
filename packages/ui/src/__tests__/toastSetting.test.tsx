import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToasts } from '../components/ToastContainer.tsx';
import { DEFAULT_SETTINGS, setSettings } from '../services/settings.ts';

const content = { title: 'shop-web · Done', stage: 'Done', lines: ['Tool: Bash'] };

afterEach(() => {
  setSettings(() => DEFAULT_SETTINGS);
});

describe('toast setting', () => {
  it('shows toasts by default', () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.addToast('success', content));
    expect(result.current.toasts).toHaveLength(1);
  });

  it('drops toasts while they are turned off in settings', () => {
    setSettings((prev) => ({ ...prev, notifications: { ...prev.notifications, toasts: false } }));
    const { result } = renderHook(() => useToasts());
    act(() => result.current.addToast('success', content));
    expect(result.current.toasts).toHaveLength(0);
  });
});
