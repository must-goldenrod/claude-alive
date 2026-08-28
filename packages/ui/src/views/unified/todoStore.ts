/**
 * Lightweight personal to-do list persisted in localStorage.
 *
 * This is a plain jot-list living in the right panel — not tied to agents,
 * tickets, or sessions. It survives reloads/restarts so the user can keep a
 * running checklist across sessions.
 *
 * Storage shape: a JSON array of TodoItem, in display order (oldest-first).
 * Text is capped at MAX_TEXT_LENGTH characters per item.
 */

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

const STORAGE_KEY = 'claude-alive:todos:v1';
export const MAX_TEXT_LENGTH = 1000;

function readRaw(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(todos: TodoItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch {
    // Quota or disabled storage — silently ignore; the list is best-effort.
  }
}

function isTodoItem(value: unknown): value is TodoItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    typeof item.done === 'boolean'
  );
}

/** Return the stored to-do items (oldest-first display order). */
export function loadTodos(): TodoItem[] {
  const data = readRaw();
  if (!Array.isArray(data)) return [];
  return data.filter(isTodoItem);
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to timestamp-based id
  }
  return `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Append a new item built from `text`. Whitespace is trimmed and the result is
 * capped to MAX_TEXT_LENGTH. Empty text is a no-op. Returns the new list.
 */
export function addTodo(text: string): TodoItem[] {
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!trimmed) return loadTodos();
  const next = [...loadTodos(), { id: newId(), text: trimmed, done: false }];
  writeRaw(next);
  return next;
}

/** Toggle the `done` flag of the item with `id`. Returns the new list. */
export function toggleTodo(id: string): TodoItem[] {
  const next = loadTodos().map((item) =>
    item.id === id ? { ...item, done: !item.done } : item,
  );
  writeRaw(next);
  return next;
}

/** Remove the item with `id`. Returns the new list. */
export function removeTodo(id: string): TodoItem[] {
  const next = loadTodos().filter((item) => item.id !== id);
  writeRaw(next);
  return next;
}
