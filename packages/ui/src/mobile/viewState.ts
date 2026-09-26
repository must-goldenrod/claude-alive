/**
 * Where the phone was: tab, filter, the ticket or terminal on screen, a
 * half-written goal.
 *
 * A phone browser throws a backgrounded tab away within minutes and reloads it
 * when the user comes back — the WebSocket reconnects, and every screen used to
 * start over on the ticket list with the filter reset. The data itself is
 * refetched from the server either way; what was lost is only this, and it is
 * small enough to keep per device in localStorage.
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

export const VIEW_KEY_PREFIX = 'claude-alive.mobile.view.';

function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored value, or undefined when absent, unreadable or no longer valid. */
export function readView<T>(key: string, isValid: (value: unknown) => value is T): T | undefined {
  try {
    const raw = storage()?.getItem(VIEW_KEY_PREFIX + key);
    if (raw == null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Store a value; null removes it, so a cleared screen does not come back. */
export function writeView<T>(key: string, value: T | null): void {
  try {
    const store = storage();
    if (value === null) store?.removeItem(VIEW_KEY_PREFIX + key);
    else store?.setItem(VIEW_KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode or full storage: the screen still works, it just won't be restored */
  }
}

/** `useState` that starts from the stored value and writes every change back. */
export function usePersistedState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readView(key, isValid) ?? fallback);
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      writeView(key, resolved);
      return resolved;
    });
  }, [key]);
  return [value, set];
}

/** Validator for a closed set of string values. */
export function oneOf<T extends string>(...values: readonly T[]): (value: unknown) => value is T {
  return (value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);
}

export const isString = (value: unknown): value is string => typeof value === 'string';

export const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
