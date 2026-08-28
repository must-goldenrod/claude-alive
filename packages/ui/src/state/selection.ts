import type { Run } from '@claude-alive/core';

/**
 * Sidebar selection, split into two independent ideas:
 *   - filter (repoId / worktreeId): narrows what a view lists
 *   - focus  (runId): which run a view should open
 *
 * They are separate because clicking a run must not hide its siblings — the
 * list has to stay navigable while you read one item.
 */
export interface Selection {
  repoId: string | null;
  worktreeId: string | null;
  runId: string | null;
  /** Hide closed/abandoned runs. */
  openOnly: boolean;
}

export const EMPTY_SELECTION: Selection = {
  repoId: null, worktreeId: null, runId: null, openOnly: false,
};

export type SelectionAction =
  | { type: 'selectRepo'; repoId: string }
  | { type: 'selectWorktree'; repoId: string; worktreeId: string }
  | { type: 'focusRun'; run: Run }
  | { type: 'clear' }
  | { type: 'toggleOpenOnly' };

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'selectRepo':
      // Clicking the already-selected repo deselects it, so the same click both
      // drills in and backs out.
      return state.repoId === action.repoId
        ? { ...state, repoId: null, worktreeId: null, runId: null }
        : { ...state, repoId: action.repoId, worktreeId: null, runId: null };

    case 'selectWorktree':
      return state.worktreeId === action.worktreeId
        ? { ...state, worktreeId: null, runId: null }
        : { ...state, repoId: action.repoId, worktreeId: action.worktreeId, runId: null };

    case 'focusRun':
      return {
        ...state,
        repoId: action.run.repoId,
        worktreeId: action.run.worktreeId,
        runId: action.run.runId,
      };

    case 'clear':
      return { ...EMPTY_SELECTION, openOnly: state.openOnly };

    case 'toggleOpenOnly':
      return { ...state, openOnly: !state.openOnly };
  }
}

/** Does this run survive the current filter? Focus deliberately does not filter. */
export function matchesSelection(run: Run, selection: Selection): boolean {
  if (selection.repoId && run.repoId !== selection.repoId) return false;
  if (selection.worktreeId && run.worktreeId !== selection.worktreeId) return false;
  if (selection.openOnly && (run.state === 'closed' || run.state === 'abandoned')) return false;
  return true;
}

const KEY = 'claude-alive.selection';

export function loadSelection(storage: Pick<Storage, 'getItem'>): Selection {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return EMPTY_SELECTION;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_SELECTION;
    const p = parsed as Partial<Selection>;
    return {
      repoId: typeof p.repoId === 'string' ? p.repoId : null,
      worktreeId: typeof p.worktreeId === 'string' ? p.worktreeId : null,
      runId: typeof p.runId === 'string' ? p.runId : null,
      openOnly: p.openOnly === true,
    };
  } catch {
    return EMPTY_SELECTION;
  }
}

export function saveSelection(storage: Pick<Storage, 'setItem'>, selection: Selection): void {
  try {
    storage.setItem(KEY, JSON.stringify(selection));
  } catch {
    // Private mode / blocked storage: the selection just does not persist.
  }
}
