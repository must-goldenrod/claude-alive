import { describe, expect, it } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { filterTicketsBySelection } from '../views/tickets/ticketFilter.ts';
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

  it('drops a ticket that has no run yet when a filter is active', () => {
    const out = filterTicketsBySelection([ticket('c', '/z')], RUNS, { ...EMPTY_SELECTION, repoId: 'r1' });
    expect(out).toEqual([]);
  });

  it('keeps a ticket that has no run when no filter is active', () => {
    expect(filterTicketsBySelection([ticket('c', '/z')], RUNS, EMPTY_SELECTION)).toHaveLength(1);
  });
});
