/**
 * Which sidebar rows are expanded.
 *
 * Kept apart from `Selection` because they answer different questions: expansion
 * is how much of the tree you can see, selection is which repo/branch the rest
 * of the app is pointed at. A row click does both, but only expansion is stored
 * here — selection persists separately and drives the board and the composer.
 *
 * Rows are expanded by default (the sidebar's job is to show work), so the sets
 * store the COLLAPSED ids: an unknown row is open, and a repo or branch that
 * appears for the first time shows its contents instead of hiding them.
 */
export interface ExpandState {
  /** Repo ids the user has collapsed. Hides every branch beneath. */
  collapsedRepos: readonly string[];
  /** Worktree ids the user has collapsed. Hides that branch's tickets. */
  collapsedWorktrees: readonly string[];
}

export const EMPTY_EXPAND: ExpandState = { collapsedRepos: [], collapsedWorktrees: [] };

export function isRepoExpanded(state: ExpandState, repoId: string): boolean {
  return !state.collapsedRepos.includes(repoId);
}

export function isWorktreeExpanded(state: ExpandState, worktreeId: string): boolean {
  return !state.collapsedWorktrees.includes(worktreeId);
}

function flip(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Toggle exactly one repository, leaving every other row untouched.
 *
 * The single-row guarantee is the point: an earlier version derived expansion
 * from selection, so opening one repo collapsed the others and the list moved
 * under the pointer.
 */
export function toggleRepo(state: ExpandState, repoId: string): ExpandState {
  return { ...state, collapsedRepos: flip(state.collapsedRepos, repoId) };
}

/** Toggle exactly one branch's ticket list. */
export function toggleWorktree(state: ExpandState, worktreeId: string): ExpandState {
  return { ...state, collapsedWorktrees: flip(state.collapsedWorktrees, worktreeId) };
}

const KEY = 'claude-alive.sidebarExpand';

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

export function loadExpand(storage: Pick<Storage, 'getItem'>): ExpandState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return EMPTY_EXPAND;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_EXPAND;
    const p = parsed as Partial<Record<keyof ExpandState, unknown>>;
    return {
      collapsedRepos: stringList(p.collapsedRepos),
      collapsedWorktrees: stringList(p.collapsedWorktrees),
    };
  } catch {
    return EMPTY_EXPAND;
  }
}

export function saveExpand(storage: Pick<Storage, 'setItem'>, state: ExpandState): void {
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode / blocked storage: expansion just does not persist.
  }
}
