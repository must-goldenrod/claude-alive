import type { Ticket } from './types.js';

/**
 * When something last happened on this ticket.
 *
 * `startedAt` alone answers "when did this begin", which is the wrong question
 * for a board you scan to find stalled work: a ticket started three weeks ago
 * whose human replied a minute ago is live, and one started a minute ago that
 * has said nothing since is not. The newest turn is the strongest signal, so
 * this takes the max across every timestamp a ticket carries rather than
 * trusting any single field to be the latest.
 */
export function ticketLastActivityAt(ticket: Ticket): number {
  let latest = ticket.createdAt;
  const bump = (at?: number): void => {
    if (at !== undefined && at > latest) latest = at;
  };
  bump(ticket.startedAt);
  bump(ticket.endedAt);
  for (const turn of ticket.turns ?? []) bump(turn.at);
  return latest;
}
