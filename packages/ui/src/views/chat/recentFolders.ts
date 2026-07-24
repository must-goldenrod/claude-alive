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
 *
 * ## Scoping
 * An optional `scope` namespaces the history so histories that live in
 * different path-spaces never mix. Local folders use the default (unscoped)
 * store; a remote SSH host passes a per-host scope (e.g. `user@host:port`) so
 * that `/home/x` on server A and the same path on server B stay separate — a
 * remote path must never be offered as a shortcut on the wrong host. The
 * default (unscoped) key is kept verbatim for backward compatibility.
 */

const STORAGE_KEY = 'claude-alive:recent-folders:v1';
const MAX_ENTRIES = 10;

/** Build the localStorage key for a given scope (unscoped → the legacy key). */
function storageKey(scope?: string): string {
  return scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY;
}

function readRaw(scope?: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(folders: string[], scope?: string): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(folders));
  } catch {
    // Quota or disabled storage — silently ignore; history is best-effort.
  }
}

/** Return the recent folders list (most-recent-first) for the given scope. */
export function loadRecentFolders(scope?: string): string[] {
  const data = readRaw(scope);
  if (!Array.isArray(data)) return [];
  return data.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * LRU-style push: if `cwd` is already in the list it's moved to the front;
 * otherwise it's prepended. The list is then truncated to MAX_ENTRIES.
 * Returns the new list so the caller can update React state in one go.
 */
export function pushRecentFolder(cwd: string, scope?: string): string[] {
  if (!cwd) return loadRecentFolders(scope);
  const current = loadRecentFolders(scope);
  const next = [cwd, ...current.filter((p) => p !== cwd)].slice(0, MAX_ENTRIES);
  writeRaw(next, scope);
  return next;
}

/** Remove a folder from history (e.g. via context menu or stale-path cleanup). */
export function removeRecentFolder(cwd: string, scope?: string): string[] {
  const next = loadRecentFolders(scope).filter((p) => p !== cwd);
  writeRaw(next, scope);
  return next;
}
