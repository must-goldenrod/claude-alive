import type { Ticket, TicketEvaluation } from '@claude-alive/core';
import { ticketLastActivityAt } from '@claude-alive/core';
import type { ResolvedLocation } from '../gitResolver.js';
import type { RunUpsert } from '../runStore.js';

/**
 * Ticket → Run.
 *
 * A ticket that reached `done` or `failed` still reports `waiting`: the agent is
 * finished, but nobody has filed the result yet. That gap is exactly what the
 * run registry exists to make visible, so it must not collapse into `closed`.
 * The gap ends when a human evaluates the ticket — see `ticketRunOutcome`.
 */
export function ticketToUpsert(ticket: Ticket, location: ResolvedLocation): RunUpsert {
  const running = ticket.state === 'queued' || ticket.state === 'running' || ticket.state === 'verifying';
  return {
    runId: `ticket:${ticket.id}`,
    location,
    kind: 'ticket',
    sourceId: ticket.id,
    title: ticket.goal,
    state: running ? 'running' : 'waiting',
    startedAt: ticket.startedAt ?? ticket.createdAt,
    lastActivityAt: ticketLastActivityAt(ticket),
    meta: {
      seq: ticket.seq,
      ...(ticket.headline ? { headline: ticket.headline } : {}),
      ...(ticket.usage?.costUsd !== undefined ? { costUsd: ticket.usage.costUsd } : {}),
      ...(ticket.usage?.durationMs !== undefined ? { durationMs: ticket.usage.durationMs } : {}),
      ...(ticket.model ? { model: ticket.model } : {}),
    },
  };
}

/**
 * The line to file a ticket's run away with, or null while it is still open.
 *
 * The board already has a "filed away" step — the human's good/bad evaluation,
 * which moves a card from 완료 to 종료. Without this the run registry never
 * learned about that step, so every evaluated ticket stayed `waiting` forever
 * and the sidebar's unfinished count grew without bound while the board showed
 * nothing in progress. The two surfaces now settle on the same event.
 */
export function ticketRunOutcome(
  ticket: Ticket,
  evaluation: TicketEvaluation | undefined,
): string | null {
  const terminal = ticket.state === 'done' || ticket.state === 'failed';
  if (!terminal || !evaluation?.humanLabeled) return null;
  return ticket.headline?.trim() || ticket.error?.trim() || evaluation.label;
}

/** Just the run fields the orphan sweep needs, so callers pass whole `Run`s. */
interface RunRef {
  runId: string;
  kind: string;
  sourceId: string;
}

/**
 * Ticket runs whose ticket is gone.
 *
 * Deletion used to drop the ticket and leave its run behind, so the sidebar kept
 * listing work that no longer existed — and counted it as unfinished. Deletion
 * now removes both, but installs that predate the fix still carry the leftovers,
 * and a ticket can also be evicted by the store's retention cap. Sweeping at
 * startup keeps the registry honest either way.
 *
 * Only `ticket` runs are considered: other kinds answer to other stores, and
 * treating an unknown sourceId as an orphan would delete live terminals.
 */
export function orphanTicketRunIds(
  runs: readonly RunRef[],
  ticketIds: ReadonlySet<string>,
): string[] {
  return runs
    .filter((run) => run.kind === 'ticket' && !ticketIds.has(run.sourceId))
    .map((run) => run.runId);
}
