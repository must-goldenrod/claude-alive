import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TodoList } from '../views/unified/TodoList.js';

// The Node/jsdom localStorage stub lacks removeItem/clear, so inject a full
// Map-backed implementation (see memory: vitest-localstorage-node-stub).
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

// Resolve i18n keys to predictable strings so queries are stable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'todo.title': 'To-do',
        'todo.placeholder': 'Add a note',
        'todo.empty': 'No items yet',
        'todo.remove': 'Remove',
        'todo.confirmRemove': 'Remove?',
      };
      return map[key] ?? key;
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TodoList Enter handling — IME composition guard', () => {
  it('does NOT submit when Enter fires during an IME composition', () => {
    // Regression: Korean/Japanese/Chinese input confirms the last composed char
    // with Enter. Without the isComposing guard that same Enter also submitted,
    // duplicating the final character.
    render(<TodoList />);
    const input = screen.getByPlaceholderText('Add a note') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '할일' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    // No item added; draft is preserved for the follow-up (non-composing) Enter.
    expect(screen.getByText('No items yet')).toBeTruthy();
    expect(input.value).toBe('할일');
  });

  it('submits on a plain Enter (composition already finished)', () => {
    render(<TodoList />);
    const input = screen.getByPlaceholderText('Add a note') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '할일' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false });

    expect(screen.getByText('할일')).toBeTruthy();
    expect(input.value).toBe('');
  });
});
