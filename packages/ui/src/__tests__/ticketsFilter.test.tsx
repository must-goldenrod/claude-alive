import { describe, expect, it } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { filterTicketsBySelection, selectedCwd } from '../views/tickets/ticketFilter.ts';
import { EMPTY_SELECTION } from '../state/selection.ts';

const ticket = (id: string, cwd: string): Ticket =>
  ({ id, seq: 1, goal: id, cwd, state: 'running', createdAt: 1 } as Ticket);

const RUNS = [
  { runId: 'ticket:a', sourceId: 'a', repoId: 'r1', worktreeId: 'w1' },
  { runId: 'ticket:b', sourceId: 'b', repoId: 'r2', worktreeId: 'w2' },
];

describe('filterTicketsBySelection', () => {
  it('passes everything through with an empty selection', () => {
    const out = filterTicketsBySelection([ticket('a', '/x'), ticket('b', '/y')], RUNS, EMPTY_SELECTION);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps only tickets whose run is in the selected repo', () => {
    const out = filterTicketsBySelection(
      [ticket('a', '/x'), ticket('b', '/y')], RUNS, { ...EMPTY_SELECTION, repoId: 'r1' },
    );
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('keeps only tickets whose run is in the selected worktree', () => {
    const out = filterTicketsBySelection(
      [ticket('a', '/x'), ticket('b', '/y')], RUNS, { ...EMPTY_SELECTION, repoId: 'r2', worktreeId: 'w2' },
    );
    expect(out.map((x) => x.id)).toEqual(['b']);
  });

  it('places a ticket that has no run yet by its cwd', () => {
    const wts = [{ worktreeId: 'w1', repoId: 'r1', path: '/x' }, { worktreeId: 'w2', repoId: 'r2', path: '/y' }];
    const out = filterTicketsBySelection(
      [ticket('c', '/y/sub')], RUNS, { ...EMPTY_SELECTION, repoId: 'r1' }, wts,
    );
    expect(out).toEqual([]);
    expect(
      filterTicketsBySelection([ticket('c', '/y/sub')], RUNS, { ...EMPTY_SELECTION, repoId: 'r2' }, wts)
        .map((x) => x.id),
    ).toEqual(['c']);
  });

  it('prefers the deepest matching worktree over its parent', () => {
    const wts = [
      { worktreeId: 'w1', repoId: 'r1', path: '/x' },
      { worktreeId: 'w2', repoId: 'r2', path: '/x/inner' },
    ];
    const out = filterTicketsBySelection(
      [ticket('c', '/x/inner/pkg')], RUNS, { ...EMPTY_SELECTION, repoId: 'r2' }, wts,
    );
    expect(out.map((x) => x.id)).toEqual(['c']);
  });

  it('keeps an unplaceable ticket rather than making it vanish mid-create', () => {
    const out = filterTicketsBySelection([ticket('c', '/z')], RUNS, { ...EMPTY_SELECTION, repoId: 'r1' });
    expect(out.map((x) => x.id)).toEqual(['c']);
  });

  it('keeps a ticket that has no run when no filter is active', () => {
    expect(filterTicketsBySelection([ticket('c', '/z')], RUNS, EMPTY_SELECTION)).toHaveLength(1);
  });
});

describe('selectedCwd', () => {
  const WTS = [
    { worktreeId: 'w1', repoId: 'r1', path: '/r/alive' },
    { worktreeId: 'w2', repoId: 'r1', path: '/r/wt-feature' },
  ];

  it('is null while nothing is selected, so the picker stays in charge', () => {
    expect(selectedCwd(EMPTY_SELECTION, WTS)).toBeNull();
  });

  it('uses the exact checkout when a branch is selected', () => {
    expect(selectedCwd({ ...EMPTY_SELECTION, repoId: 'r1', worktreeId: 'w2' }, WTS)).toBe('/r/wt-feature');
  });

  it('falls back to the primary worktree for a repository', () => {
    expect(selectedCwd({ ...EMPTY_SELECTION, repoId: 'r1' }, WTS, new Set(['w2']))).toBe('/r/wt-feature');
  });

  it('takes the only worktree when none is marked primary', () => {
    expect(selectedCwd({ ...EMPTY_SELECTION, repoId: 'r1' }, WTS)).toBe('/r/alive');
  });

  it('is null for a repository with no worktrees yet', () => {
    expect(selectedCwd({ ...EMPTY_SELECTION, repoId: 'nope' }, WTS)).toBeNull();
  });
});
