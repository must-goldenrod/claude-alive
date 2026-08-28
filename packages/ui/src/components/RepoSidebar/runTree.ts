import type { Repository, Run, RunTree, Worktree } from '@claude-alive/core';
import { matchesSelection, type Selection } from '../../state/selection.ts';

export interface WorktreeNode {
  worktree: Worktree;
  openCount: number;
  runs: Run[];
}

export interface RepoNode {
  repo: Repository;
  openCount: number;
  worktrees: WorktreeNode[];
}

function isOpen(run: Run): boolean {
  return run.state === 'running' || run.state === 'waiting';
}

/**
 * Shape the flat wire tree into the nested sidebar model.
 *
 * The filter applies to RUNS only; a repository with no runs still shows so you
 * can start one there. When `openOnly` is on, empty branches are pruned — the
 * point of that mode is a short list of what still needs attention.
 */
export function buildTree(tree: RunTree, selection: Selection): RepoNode[] {
  const visible = tree.runs.filter((run) => matchesSelection(run, selection));
  const byWorktree = new Map<string, Run[]>();
  for (const run of visible) {
    const bucket = byWorktree.get(run.worktreeId);
    if (bucket) bucket.push(run);
    else byWorktree.set(run.worktreeId, [run]);
  }

  const nodes: RepoNode[] = tree.repositories.map((repo) => {
    const worktrees: WorktreeNode[] = tree.worktrees
      .filter((w) => w.repoId === repo.repoId)
      .map((worktree) => {
        const runs = [...(byWorktree.get(worktree.worktreeId) ?? [])].sort(compareRuns);
        return { worktree, runs, openCount: runs.filter(isOpen).length };
      })
      .filter((node) => !selection.openOnly || node.runs.length > 0);

    return {
      repo,
      worktrees,
      openCount: worktrees.reduce((sum, w) => sum + w.openCount, 0),
    };
  });

  return nodes
    .filter((node) => !selection.openOnly || node.worktrees.length > 0)
    .sort(compareRepos);
}

/** Open runs first, then most recently started first. */
function compareRuns(a: Run, b: Run): number {
  if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
  return b.startedAt - a.startedAt;
}

/** Most unfinished work first, then alphabetical so the order is stable. */
function compareRepos(a: RepoNode, b: RepoNode): number {
  if (a.openCount !== b.openCount) return b.openCount - a.openCount;
  return (a.repo.name ?? a.repo.root).localeCompare(b.repo.name ?? b.repo.root);
}

/** Age of the longest-open run, for the sidebar's summary line. */
export function oldestOpenAge(tree: RunTree, now: number): number | null {
  const open = tree.runs.filter(isOpen);
  if (open.length === 0) return null;
  const oldest = open.reduce((min, run) => Math.min(min, run.startedAt), Number.POSITIVE_INFINITY);
  return now - oldest;
}
