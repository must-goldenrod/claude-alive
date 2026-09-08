import type { Ticket, TicketLocation } from '@claude-alive/core';
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

/** Just the repository fields needed to say which machine a path is on. */
export interface RepoLocationRef {
  repoId: string;
  location?: TicketLocation;
}

/** A working directory together with the machine it exists on. */
export interface SelectedTarget {
  cwd: string;
  location?: TicketLocation;
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
 * The working directory the sidebar's current selection points at.
 *
 * A branch names an exact checkout, so it wins. A repository on its own falls
 * back to its primary worktree (or its only one), which is what "start work in
 * this project" means when no branch has been picked. Returns null when nothing
 * is selected, leaving the composer's own picker in charge.
 */
export function selectedCwd(
  selection: Selection,
  worktrees: readonly WorktreeLocationRef[],
  primaryWorktreeIds: ReadonlySet<string> = new Set(),
): string | null {
  if (selection.worktreeId) {
    return worktrees.find((w) => w.worktreeId === selection.worktreeId)?.path ?? null;
  }
  if (!selection.repoId) return null;
  const inRepo = worktrees.filter((w) => w.repoId === selection.repoId);
  if (inRepo.length === 0) return null;
  const primary = inRepo.find((w) => primaryWorktreeIds.has(w.worktreeId));
  return (primary ?? inRepo[0]!).path;
}

/**
 * The same selection, as a path AND the machine that path is on.
 *
 * A path alone is ambiguous — an SSH checkout's root is a string like any
 * other, and handing one to a local agent points it at a directory this machine
 * does not have. Callers that act on the selection (the ticket composer) must
 * use this rather than `selectedCwd`.
 */
export function selectedTarget(
  selection: Selection,
  worktrees: readonly WorktreeLocationRef[],
  repositories: readonly RepoLocationRef[] = [],
  primaryWorktreeIds: ReadonlySet<string> = new Set(),
): SelectedTarget | null {
  const cwd = selectedCwd(selection, worktrees, primaryWorktreeIds);
  if (cwd === null) return null;
  // The worktree names the repo even when the filter was set by branch, so the
  // location is found the same way in both cases.
  const repoId = selection.worktreeId
    ? worktrees.find((w) => w.worktreeId === selection.worktreeId)?.repoId
    : selection.repoId;
  const location = repositories.find((r) => r.repoId === repoId)?.location;
  return location ? { cwd, location } : { cwd };
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
