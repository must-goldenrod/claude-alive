import type { Ticket } from '@claude-alive/core';
import type { Selection } from '../../state/selection.ts';

/** Just the run fields this filter needs, so tests do not build whole Runs. */
export interface RunLocationRef {
  sourceId: string;
  repoId: string;
  worktreeId: string;
}

/** Just the worktree fields this filter needs to place a ticket by its cwd. */
export interface WorktreeLocationRef {
  worktreeId: string;
  repoId: string;
  path: string;
}

interface Placement {
  repoId: string;
  worktreeId: string;
}

/**
 * Where a ticket lives, by its run if one exists and by its cwd if not.
 *
 * The run registry is authoritative but lags: a ticket queued behind the
 * concurrency limit has no run until it starts, and mirroring is async. Falling
 * back to the cwd means a ticket is placed the instant it is created.
 */
function placeTicket(
  ticket: Ticket,
  bySource: Map<string, RunLocationRef>,
  worktrees: readonly WorktreeLocationRef[],
): Placement | null {
  const run = bySource.get(ticket.id);
  if (run) return { repoId: run.repoId, worktreeId: run.worktreeId };

  // Longest matching path wins so a nested worktree beats its parent repo.
  let best: WorktreeLocationRef | null = null;
  for (const wt of worktrees) {
    if (ticket.cwd !== wt.path && !ticket.cwd.startsWith(`${wt.path}/`)) continue;
    if (!best || wt.path.length > best.path.length) best = wt;
  }
  return best ? { repoId: best.repoId, worktreeId: best.worktreeId } : null;
}

/**
 * Narrow the ticket board to the sidebar's filter.
 *
 * A ticket that cannot be placed at all is KEPT rather than dropped. Dropping
 * was the old behaviour and it made a freshly created ticket disappear from the
 * board entirely whenever a repo was selected — indistinguishable from the
 * create having failed. An unplaceable ticket cannot be proven to be elsewhere
 * either, and a stray card is a far smaller lie than a missing one.
 */
export function filterTicketsBySelection(
  tickets: Ticket[],
  runs: readonly RunLocationRef[],
  selection: Selection,
  worktrees: readonly WorktreeLocationRef[] = [],
): Ticket[] {
  if (!selection.repoId && !selection.worktreeId) return tickets;

  const bySource = new Map(runs.map((r) => [r.sourceId, r]));
  return tickets.filter((ticket) => {
    const at = placeTicket(ticket, bySource, worktrees);
    if (!at) return true;
    if (selection.repoId && at.repoId !== selection.repoId) return false;
    if (selection.worktreeId && at.worktreeId !== selection.worktreeId) return false;
    return true;
  });
}
