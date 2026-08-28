import type { Ticket } from '@claude-alive/core';
import type { Selection } from '../../state/selection.ts';

/** Just the run fields this filter needs, so tests do not build whole Runs. */
export interface RunLocationRef {
  sourceId: string;
  repoId: string;
  worktreeId: string;
}

/**
 * Narrow the ticket board to the sidebar's filter.
 *
 * A ticket with no run yet (registered a moment ago, or a backfill that failed)
 * is kept when nothing is filtered and dropped when something is — it cannot be
 * proven to belong to the selected repo, and showing it there would be a lie.
 */
export function filterTicketsBySelection(
  tickets: Ticket[],
  runs: readonly RunLocationRef[],
  selection: Selection,
): Ticket[] {
  if (!selection.repoId && !selection.worktreeId) return tickets;

  const bySource = new Map(runs.map((r) => [r.sourceId, r]));
  return tickets.filter((ticket) => {
    const run = bySource.get(ticket.id);
    if (!run) return false;
    if (selection.repoId && run.repoId !== selection.repoId) return false;
    if (selection.worktreeId && run.worktreeId !== selection.worktreeId) return false;
    return true;
  });
}
