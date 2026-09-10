import type { Ticket, TicketAgentExit } from '@claude-alive/core';

/**
 * Recover an exit record from a ticket that failed before the server recorded one.
 *
 * Tickets are kept for 500 entries, so the failures that motivated this feature
 * are still on screen — and they carry only the two sentences the old runner
 * wrote: `main agent exited (code N)` and `failed to spawn claude`. Both are
 * parseable into the same facts the server now records, so an old ticket gets
 * the same explanation instead of staying a number forever.
 *
 * Only those two exact shapes are recognised. Anything else returns undefined:
 * guessing at an arbitrary error string would put words in the runner's mouth.
 */
const EXITED = /^main agent exited \(code (\d+)\)$/;
const SPAWN_FAILED = 'failed to spawn claude';

const CAUSE_BY_SIGNAL_CODE: Readonly<Record<number, TicketAgentExit['cause']>> = {
  129: 'hangup',
  130: 'interrupted',
  137: 'killed',
  143: 'terminated',
};

const SIGNAL_BY_CODE: Readonly<Record<number, string>> = {
  129: 'SIGHUP',
  130: 'SIGINT',
  137: 'SIGKILL',
  143: 'SIGTERM',
};

export function legacyAgentExit(
  ticket: Pick<Ticket, 'error' | 'failureReason' | 'startedAt' | 'endedAt' | 'rounds' | 'claudeSessionId'>,
): TicketAgentExit | undefined {
  if (ticket.failureReason !== 'error') return undefined;
  const message = ticket.error?.trim();
  if (!message) return undefined;

  const ranMs =
    ticket.startedAt !== undefined && ticket.endedAt !== undefined && ticket.endedAt >= ticket.startedAt
      ? ticket.endedAt - ticket.startedAt
      : undefined;
  const common = {
    ...(ranMs !== undefined ? { ranMs } : {}),
    round: (ticket.rounds ?? 0) + 1,
    resumable: Boolean(ticket.claudeSessionId),
  };

  if (message === SPAWN_FAILED) return { cause: 'spawn-failed', ...common };

  const exited = EXITED.exec(message);
  if (!exited) return undefined;
  const code = Number(exited[1]);
  const signal = SIGNAL_BY_CODE[code];
  return {
    cause: CAUSE_BY_SIGNAL_CODE[code] ?? 'exited',
    code,
    ...(signal ? { signal, signalInferred: true } : {}),
    ...common,
  };
}
