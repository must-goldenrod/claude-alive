import type { Ticket, TicketState } from '@claude-alive/core';

/** UI collapses the 5 internal states into 3 the user reasons about. */
export type StatusGroup = 'active' | 'done' | 'failed';

export function statusGroup(state: TicketState): StatusGroup {
  if (state === 'done') return 'done';
  if (state === 'failed') return 'failed';
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
