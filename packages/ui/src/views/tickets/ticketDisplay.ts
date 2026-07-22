import type { Ticket, TicketState, TicketEvaluation } from '@claude-alive/core';

/** Legacy 3-way grouping (still used where only active/terminal matters). */
export type StatusGroup = 'active' | 'done' | 'failed';

export function statusGroup(state: TicketState): StatusGroup {
  if (state === 'done') return 'done';
  if (state === 'failed') return 'failed';
  return 'active';
}

/**
 * Four user-facing statuses:
 * - active:   진행중 — queued/running/verifying.
 * - complete: 완료   — the agent finished its work (state `done`), awaiting review.
 * - closed:   종료   — a human evaluated it (Good/Bad), so it is wrapped up.
 * - failed:   실패   — the run failed.
 *
 * `complete` → `closed` is the human-evaluation step: it flips once the ticket's
 * evaluation is human-labelled.
 */
export type DisplayStatus = 'active' | 'complete' | 'closed' | 'failed';

export function displayStatus(state: TicketState, evaluation?: TicketEvaluation | null): DisplayStatus {
  if (state === 'failed') return 'failed';
  if (state === 'done') return evaluation?.humanLabeled ? 'closed' : 'complete';
  return 'active';
}

/** Project badge = the cwd's last path segment. */
export function projectName(cwd: string): string {
  const parts = cwd.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || cwd;
}

/** Compact "MM-DD HH:mm" for the card. Uses startedAt, falling back to createdAt. */
export function formatStarted(ticket: Ticket): string {
  const ms = ticket.startedAt ?? ticket.createdAt;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The one-line result shown on the card. Prefers the agent's explicit HEADLINE,
 * then falls back to the first meaningful line of the result body (stripped of
 * markdown heading/list/emphasis markers). Returns null when there is nothing yet.
 */
export function oneLineSummary(ticket: Ticket): string | null {
  if (ticket.headline?.trim()) return ticket.headline.trim();
  if (ticket.result?.trim()) {
    const line = ticket.result
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !/^[-*#>|`]+\s*$/.test(l));
    if (line) {
      return line
        .replace(/^#{1,6}\s+/, '') // heading markers
        .replace(/^[-*+]\s+/, '') // list bullets
        .replace(/^\d+\.\s+/, '') // ordered list
        .replace(/[*_`]/g, '') // emphasis / code ticks
        .trim();
    }
  }
  return null;
}
