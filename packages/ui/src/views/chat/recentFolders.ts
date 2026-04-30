/**
 * Recently selected cwd history stored in localStorage.
 *
 * The local-folder picker uses this to surface paths the user has actually
 * launched a tab in — which matches user intent ("recent folders") far more
 * closely than scanning `~/.claude/projects/<slug>` jsonl mtimes (which only
 * sees sessions started in that exact slug).
 *
 * Storage shape: a JSON array of absolute paths, most-recent-first.
 * Soft-cap MAX_ENTRIES; older entries are dropped on push.
 */

const STORAGE_KEY = 'claude-alive:recent-folders:v1';
const MAX_ENTRIES = 10;

function readRaw(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(folders: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
  } catch {
    // Quota or disabled storage — silently ignore; history is best-effort.
  }
}

/** Return the recent folders list (most-recent-first). */
export function loadRecentFolders(): string[] {
  const data = readRaw();
  if (!Array.isArray(data)) return [];
  return data.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * LRU-style push: if `cwd` is already in the list it's moved to the front;
 * otherwise it's prepended. The list is then truncated to MAX_ENTRIES.
 * Returns the new list so the caller can update React state in one go.
 */
export function pushRecentFolder(cwd: string): string[] {
  if (!cwd) return loadRecentFolders();
  const current = loadRecentFolders();
  const next = [cwd, ...current.filter((p) => p !== cwd)].slice(0, MAX_ENTRIES);
  writeRaw(next);
  return next;
}

/** Remove a folder from history (e.g. via context menu or stale-path cleanup). */
export function removeRecentFolder(cwd: string): string[] {
  const next = loadRecentFolders().filter((p) => p !== cwd);
  writeRaw(next);
  return next;
}
