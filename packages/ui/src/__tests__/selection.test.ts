import { describe, expect, it } from 'vitest';
import type { Run } from '@claude-alive/core';
import {
  EMPTY_SELECTION, loadSelection, matchesSelection, saveSelection, selectionReducer,
} from '../state/selection.ts';

function run(over: Partial<Run> = {}): Run {
  return {
    runId: 'ticket:t-1', repoId: 'r1', worktreeId: 'w1', kind: 'ticket',
    sourceId: 't-1', title: 'goal', state: 'running', startedAt: 1, ...over,
  };
}

describe('selectionReducer', () => {
  it('selecting a repo clears the worktree and the focused run', () => {
    const start = { repoId: 'r0', worktreeId: 'w0', runId: 'x', openOnly: false };
    expect(selectionReducer(start, { type: 'selectRepo', repoId: 'r1' }))
      .toEqual({ repoId: 'r1', worktreeId: null, runId: null, openOnly: false });
  });

  it('selecting the same repo twice deselects it', () => {
    const once = selectionReducer(EMPTY_SELECTION, { type: 'selectRepo', repoId: 'r1' });
    expect(selectionReducer(once, { type: 'selectRepo', repoId: 'r1' }).repoId).toBeNull();
  });

  it('selecting a worktree also pins its repo', () => {
    const next = selectionReducer(EMPTY_SELECTION, { type: 'selectWorktree', repoId: 'r1', worktreeId: 'w1' });
    expect(next).toMatchObject({ repoId: 'r1', worktreeId: 'w1', runId: null });
  });

  it('focusing a run narrows the filter to that run worktree', () => {
    const next = selectionReducer(EMPTY_SELECTION, { type: 'focusRun', run: run() });
    expect(next).toMatchObject({ repoId: 'r1', worktreeId: 'w1', runId: 'ticket:t-1' });
  });

  it('clear resets everything but keeps openOnly', () => {
    const start = { repoId: 'r1', worktreeId: 'w1', runId: 'x', openOnly: true };
    expect(selectionReducer(start, { type: 'clear' })).toEqual({ ...EMPTY_SELECTION, openOnly: true });
  });

  it('toggleOpenOnly flips only that flag', () => {
    const start = { repoId: 'r1', worktreeId: null, runId: null, openOnly: false };
    expect(selectionReducer(start, { type: 'toggleOpenOnly' })).toEqual({ ...start, openOnly: true });
  });
});

describe('matchesSelection', () => {
  it('an empty selection matches everything', () => {
    expect(matchesSelection(run(), EMPTY_SELECTION)).toBe(true);
  });

  it('a repo filter excludes other repos', () => {
    expect(matchesSelection(run({ repoId: 'r2' }), { ...EMPTY_SELECTION, repoId: 'r1' })).toBe(false);
  });

  it('a worktree filter excludes other worktrees in the same repo', () => {
    const sel = { repoId: 'r1', worktreeId: 'w1', runId: null, openOnly: false };
    expect(matchesSelection(run({ worktreeId: 'w2' }), sel)).toBe(false);
  });

  it('openOnly excludes closed and abandoned runs', () => {
    const sel = { ...EMPTY_SELECTION, openOnly: true };
    expect(matchesSelection(run({ state: 'closed' }), sel)).toBe(false);
    expect(matchesSelection(run({ state: 'abandoned' }), sel)).toBe(false);
    expect(matchesSelection(run({ state: 'waiting' }), sel)).toBe(true);
  });

  it('a focused run does not narrow the list - focus is not a filter', () => {
    const sel = { repoId: 'r1', worktreeId: 'w1', runId: 'ticket:t-1', openOnly: false };
    expect(matchesSelection(run({ runId: 'ticket:t-2' }), sel)).toBe(true);
  });
});

describe('persistence', () => {
  it('round-trips through an injected storage', () => {
    const bag: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => bag[k] ?? null,
      setItem: (k: string, v: string) => { bag[k] = v; },
    };
    const sel = { repoId: 'r1', worktreeId: 'w1', runId: null, openOnly: true };
    saveSelection(storage, sel);
    expect(loadSelection(storage)).toEqual(sel);
  });

  it('returns the empty selection when storage holds garbage', () => {
    const storage = { getItem: () => '{{{', setItem: () => {} };
    expect(loadSelection(storage)).toEqual(EMPTY_SELECTION);
  });
});
