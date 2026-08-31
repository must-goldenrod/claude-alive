import type { Repository, Run, RunTree, Worktree } from '@claude-alive/core';
import { matchesSelection, type Selection } from '../../state/selection.ts';

/**
 * When a run last did something, falling back to its start for records written
 * before the field existed.
 *
 * Inlined rather than imported from `@claude-alive/core`: the barrel has a
 * runtime side that reaches for `node:readline`, and pulling it into the browser
 * bundle breaks the Vite build while typecheck and unit tests still pass.
 */
export function runLastActivityAt(run: Pick<Run, 'startedAt' | 'lastActivityAt'>): number {
  return run.lastActivityAt ?? run.startedAt;
}

export interface WorktreeNode {
  worktree: Worktree;
  openCount: number;
  runs: Run[];
  /** Newest activity across this branch's runs; null when it has none. */
  lastActivityAt: number | null;
}

export interface RepoNode {
  repo: Repository;
  openCount: number;
  worktrees: WorktreeNode[];
  /** Newest activity across the whole repository; null when it has no runs. */
  lastActivityAt: number | null;
}

function isOpen(run: Run): boolean {
  return run.state === 'running' || run.state === 'waiting';
}

function newest(times: readonly (number | null)[]): number | null {
  let latest: number | null = null;
  for (const t of times) {
    if (t !== null && (latest === null || t > latest)) latest = t;
  }
  return latest;
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
        return {
          worktree,
          runs,
          openCount: runs.filter(isOpen).length,
          lastActivityAt: newest(runs.map(runLastActivityAt)),
        };
      })
      .filter((node) => !selection.openOnly || node.runs.length > 0);

    return {
      repo,
      worktrees,
      openCount: worktrees.reduce((sum, w) => sum + w.openCount, 0),
      lastActivityAt: newest(worktrees.map((w) => w.lastActivityAt)),
    };
  });

  return nodes
    .filter((node) => !selection.openOnly || node.worktrees.length > 0)
    .sort(compareRepos);
}

/** Open runs first, then most recently active first. */
function compareRuns(a: Run, b: Run): number {
  if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
  return runLastActivityAt(b) - runLastActivityAt(a);
}

/**
 * Most recently active repository first, then alphabetical.
 *
 * Deliberately NOT by open count. That key changed the moment a run opened or
 * closed, so the repo you were reading jumped position under the pointer and
 * the rest of the list resettled around it. Activity time only moves when
 * something actually happens, which is the ordering the list is meant to show.
 */
function compareRepos(a: RepoNode, b: RepoNode): number {
  if (a.lastActivityAt !== b.lastActivityAt) {
    return (b.lastActivityAt ?? -Infinity) - (a.lastActivityAt ?? -Infinity);
  }
  return (a.repo.name ?? a.repo.root).localeCompare(b.repo.name ?? b.repo.root);
}

/**
 * What the still-open runs have cost so far.
 *
 * Cost has only ever been visible after the fact, in the analytics tab. The
 * number that changes behaviour is the one for work happening right now.
 */
export function openCostUsd(tree: RunTree): number {
  return tree.runs
    .filter(isOpen)
    .reduce((sum, run) => sum + (run.meta?.costUsd ?? 0), 0);
}

/** Age of the longest-open run, for the sidebar's summary line. */
export function oldestOpenAge(tree: RunTree, now: number): number | null {
  const open = tree.runs.filter(isOpen);
  if (open.length === 0) return null;
  const oldest = open.reduce((min, run) => Math.min(min, run.startedAt), Number.POSITIVE_INFINITY);
  return now - oldest;
}
