import type { Ticket } from '@claude-alive/core';
import type { ResolvedLocation } from '../gitResolver.js';
import type { RunUpsert } from '../runStore.js';

/**
 * Ticket → Run.
 *
 * A ticket that reached `done` or `failed` still reports `waiting`: the agent is
 * finished, but nobody has filed the result yet. That gap is exactly what the
 * run registry exists to make visible, so it must not collapse into `closed`.
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
    meta: {
      seq: ticket.seq,
      ...(ticket.headline ? { headline: ticket.headline } : {}),
      ...(ticket.usage?.costUsd !== undefined ? { costUsd: ticket.usage.costUsd } : {}),
      ...(ticket.usage?.durationMs !== undefined ? { durationMs: ticket.usage.durationMs } : {}),
      ...(ticket.model ? { model: ticket.model } : {}),
    },
  };
}
