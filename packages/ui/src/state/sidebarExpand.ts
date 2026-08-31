/**
 * Which sidebar rows are expanded.
 *
 * Kept apart from `Selection` on purpose. Selecting a repo FILTERS every view;
 * expanding one only changes how much of the sidebar you can see. Conflating
 * them is what made the sidebar confusing to read: clicking a repo appeared to
 * open it while quietly narrowing the whole board.
 *
 * Repos are expanded by default (the sidebar's job is to show work), so the set
 * stores the COLLAPSED ids — an unknown repo is therefore open, and a new one
 * appears expanded instead of hidden.
 */
export interface ExpandState {
  /** Repo ids the user has collapsed. */
  collapsedRepos: readonly string[];
}

export const EMPTY_EXPAND: ExpandState = { collapsedRepos: [] };

export function isRepoExpanded(state: ExpandState, repoId: string): boolean {
  return !state.collapsedRepos.includes(repoId);
}

/**
 * Toggle exactly one repo, leaving every other row untouched.
 *
 * The single-repo guarantee is the point: an earlier version derived expansion
 * from selection, so opening one repo collapsed the others and the list moved
 * under the pointer.
 */
export function toggleRepo(state: ExpandState, repoId: string): ExpandState {
  const collapsed = state.collapsedRepos.includes(repoId)
    ? state.collapsedRepos.filter((id) => id !== repoId)
    : [...state.collapsedRepos, repoId];
  return { collapsedRepos: collapsed };
}

const KEY = 'claude-alive.sidebarExpand';

export function loadExpand(storage: Pick<Storage, 'getItem'>): ExpandState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return EMPTY_EXPAND;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_EXPAND;
    const ids = (parsed as Partial<ExpandState>).collapsedRepos;
    if (!Array.isArray(ids)) return EMPTY_EXPAND;
    return { collapsedRepos: ids.filter((id): id is string => typeof id === 'string') };
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
