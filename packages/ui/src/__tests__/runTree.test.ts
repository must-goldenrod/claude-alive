import { describe, expect, it } from 'vitest';
import type { Repository, Run, RunTree, Worktree } from '@claude-alive/core';
import { buildTree, oldestOpenAge } from '../components/RepoSidebar/runTree.ts';
import { EMPTY_SELECTION } from '../state/selection.ts';

const repo = (repoId: string, name: string): Repository =>
  ({ repoId, root: `/r/${name}`, name, isGit: true });
const wt = (worktreeId: string, repoId: string, branch: string): Worktree =>
  ({ worktreeId, repoId, path: `/r/${branch}`, branch, isPrimary: branch === 'main' });
const run = (runId: string, worktreeId: string, repoId: string, over: Partial<Run> = {}): Run =>
  ({ runId, repoId, worktreeId, kind: 'ticket', sourceId: runId, title: runId,
     state: 'running', startedAt: 1000, ...over });

const TREE: RunTree = {
  repositories: [repo('r1', 'alive'), repo('r2', 'mpc')],
  worktrees: [wt('w1', 'r1', 'main'), wt('w2', 'r1', 'feat/x'), wt('w3', 'r2', 'main')],
  runs: [
    run('a', 'w1', 'r1'),
    run('b', 'w1', 'r1', { state: 'waiting' }),
    run('c', 'w2', 'r1', { state: 'closed' }),
    run('d', 'w3', 'r2', { state: 'abandoned' }),
  ],
};

describe('buildTree', () => {
  it('nests worktrees under their repository', () => {
    const nodes = buildTree(TREE, EMPTY_SELECTION);
    expect(nodes.map((n) => n.repo.repoId)).toEqual(['r1', 'r2']);
    expect(nodes[0]?.worktrees.map((w) => w.worktree.worktreeId)).toEqual(['w1', 'w2']);
  });

  it('counts only open runs in the badges', () => {
    const nodes = buildTree(TREE, EMPTY_SELECTION);
    expect(nodes[0]?.openCount).toBe(2);
    expect(nodes[0]?.worktrees[1]?.openCount).toBe(0);
    expect(nodes[1]?.openCount).toBe(0);
  });

  it('sorts repositories by open count, then by name', () => {
    const nodes = buildTree(TREE, EMPTY_SELECTION);
    expect(nodes[0]?.repo.name).toBe('alive');
  });

  it('sorts runs open-first, then newest first', () => {
    const tree: RunTree = {
      ...TREE,
      runs: [
        run('old-open', 'w1', 'r1', { startedAt: 10 }),
        run('new-closed', 'w1', 'r1', { startedAt: 900, state: 'closed' }),
        run('new-open', 'w1', 'r1', { startedAt: 800 }),
      ],
    };
    const runs = buildTree(tree, EMPTY_SELECTION)[0]?.worktrees[0]?.runs ?? [];
    expect(runs.map((r) => r.runId)).toEqual(['new-open', 'old-open', 'new-closed']);
  });

  it('openOnly drops closed runs and the worktrees left empty', () => {
    const nodes = buildTree(TREE, { ...EMPTY_SELECTION, openOnly: true });
    expect(nodes.map((n) => n.repo.repoId)).toEqual(['r1']);
    expect(nodes[0]?.worktrees.map((w) => w.worktree.worktreeId)).toEqual(['w1']);
  });

  it('keeps a repository with no runs at all when not filtering', () => {
    const tree: RunTree = { ...TREE, runs: [] };
    expect(buildTree(tree, EMPTY_SELECTION)).toHaveLength(2);
  });
});

describe('oldestOpenAge', () => {
  it('returns the age of the oldest open run', () => {
    expect(oldestOpenAge(TREE, 5000)).toBe(4000);
  });

  it('returns null when nothing is open', () => {
    const tree: RunTree = { ...TREE, runs: [run('c', 'w2', 'r1', { state: 'closed' })] };
    expect(oldestOpenAge(tree, 5000)).toBeNull();
  });
});
