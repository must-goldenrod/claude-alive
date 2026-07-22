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
export type DisplayStatus = 'active' | 'decision' | 'complete' | 'closed' | 'failed';

export function displayStatus(state: TicketState, evaluation?: TicketEvaluation | null): DisplayStatus {
  if (state === 'failed') return 'failed';
  if (state === 'decision') return 'decision';
  if (state === 'done') return evaluation?.humanLabeled ? 'closed' : 'complete';
  return 'active';
}

/**
 * One accent color per status, shared by the column header and every card in
 * that lane so the board reads by color at a glance. Values are CSS-var backed
 * so they track the theme.
 */
export const STATUS_COLOR: Record<DisplayStatus, string> = {
  active: 'var(--accent-blue, #58a6ff)',
  decision: 'var(--accent-purple, #d2a8ff)',
  complete: 'var(--accent-green, #3fb950)',
  closed: 'var(--text-secondary, #8b949e)',
  failed: 'var(--accent-red, #f85149)',
};

/** Project badge = the cwd's last path segment. */
export function projectName(cwd: string): string {
  const parts = cwd.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || cwd;
}

/** "970", "1.2k", "3.4M" — compact token counts. */
export function formatTokens(n?: number): string | null {
  if (n === undefined) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** "$0.12" / "$0.0034" — small costs keep more precision. */
export function formatCost(usd?: number): string | null {
  if (usd === undefined) return null;
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** "4.2s" / "1m 30s". */
export function formatDuration(ms?: number): string | null {
  if (ms === undefined) return null;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/**
 * Compact card meta: cumulative rounds (↻n, only after a follow-up) + model +
 * cumulative tokens + cost. Usage is summed across the initial run and replies.
 */
export function runMetaShort(ticket: Ticket): string {
  const parts: string[] = [];
  if (ticket.rounds && ticket.rounds > 1) parts.push(`↻${ticket.rounds}`);
  if (ticket.model) parts.push(ticket.model);
  const tok = formatTokens(ticket.usage?.totalTokens);
  if (tok) parts.push(`${tok} tok`);
  const cost = formatCost(ticket.usage?.costUsd);
  if (cost) parts.push(cost);
  return parts.join(' · ');
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
