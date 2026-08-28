import type { Run } from '@claude-alive/core';

/** Given a Claude session id, the ticket it was launched for (if any). */
export type TicketIdForSession = (sessionId: string) => string | undefined;

/**
 * Which run a hook event belongs to.
 *
 * A session belongs to a run in one of two ways: the run *is* that session
 * (agent and terminal runs key on it directly), or a ticket launched it and
 * recorded the id afterwards. Direct ownership wins — it is the stronger claim.
 * Returns null rather than guessing when nothing matches.
 */
export function runIdForSession(
  runs: readonly Run[],
  sessionId: string,
  ticketIdForSession: TicketIdForSession,
): string | null {
  const direct = runs.find((run) => run.sourceId === sessionId);
  if (direct) return direct.runId;

  const ticketId = ticketIdForSession(sessionId);
  if (!ticketId) return null;
  const owning = runs.find((run) => run.kind === 'ticket' && run.sourceId === ticketId);
  return owning?.runId ?? null;
}
