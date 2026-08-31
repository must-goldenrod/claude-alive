import { describe, expect, it } from 'vitest';
import {
  EMPTY_EXPAND, isRepoExpanded, isWorktreeExpanded, loadExpand, saveExpand,
  toggleRepo, toggleWorktree,
} from '../state/sidebarExpand.ts';

describe('sidebarExpand', () => {
  it('treats an unknown repo as expanded so new work is never hidden', () => {
    expect(isRepoExpanded(EMPTY_EXPAND, 'r1')).toBe(true);
  });

  it('toggles one repo and leaves the others exactly as they were', () => {
    const state = toggleRepo(toggleRepo(EMPTY_EXPAND, 'r1'), 'r2');
    const next = toggleRepo(state, 'r1');
    expect(isRepoExpanded(next, 'r1')).toBe(true);
    expect(isRepoExpanded(next, 'r2')).toBe(false);
  });

  it('never mutates the state it was given', () => {
    const state = toggleRepo(EMPTY_EXPAND, 'r1');
    toggleRepo(state, 'r2');
    expect(state.collapsedRepos).toEqual(['r1']);
  });

  it('treats an unknown branch as expanded too', () => {
    expect(isWorktreeExpanded(EMPTY_EXPAND, 'w1')).toBe(true);
  });

  it('collapsing a branch leaves its repository alone', () => {
    const next = toggleWorktree(toggleRepo(EMPTY_EXPAND, 'r1'), 'w1');
    expect(isWorktreeExpanded(next, 'w1')).toBe(false);
    expect(isRepoExpanded(next, 'r1')).toBe(false);
    expect(isWorktreeExpanded(next, 'w2')).toBe(true);
  });

  it('collapsing a repository does not collapse its branches individually', () => {
    const next = toggleRepo(EMPTY_EXPAND, 'r1');
    expect(next.collapsedWorktrees).toEqual([]);
  });

  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    saveExpand(storage, toggleWorktree(toggleRepo(EMPTY_EXPAND, 'r9'), 'w9'));
    const back = loadExpand(storage);
    expect(back.collapsedRepos).toEqual(['r9']);
    expect(back.collapsedWorktrees).toEqual(['w9']);
  });

  it('falls back to everything expanded on unreadable storage', () => {
    const storage = { getItem: () => '{{{' };
    expect(loadExpand(storage)).toEqual(EMPTY_EXPAND);
  });

  it('discards a persisted value of the wrong shape', () => {
    const storage = { getItem: () => JSON.stringify({ collapsedRepos: 'r1' }) };
    expect(loadExpand(storage)).toEqual(EMPTY_EXPAND);
  });

  it('reads a state persisted before branch collapsing existed', () => {
    const storage = { getItem: () => JSON.stringify({ collapsedRepos: ['r1'] }) };
    expect(loadExpand(storage)).toEqual({ collapsedRepos: ['r1'], collapsedWorktrees: [] });
  });
});
