/**
 * Ticket-management API client (spec 2026-07-22).
 *
 * The ticket routes are loopback-only on the server, so this view only works on
 * the local dashboard — the same restriction the Tickets view lives under.
 */
import type { TicketEvaluation, RouteGuide } from '@claude-alive/core';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export type EvalLabel = 'good' | 'bad' | 'unrated';

/** All durable ticket records (the evaluation dataset), newest activity first. */
export async function fetchRecords(): Promise<TicketEvaluation[]> {
  const res = await fetch(`${API_BASE}/api/evaluations`);
  if (!res.ok) throw new Error(`records ${res.status}`);
  const data = (await res.json()) as { evaluations?: TicketEvaluation[] };
  return (data.evaluations ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Current synthesised bias (RouteGuide) for a route. */
export async function fetchGuide(route: string): Promise<RouteGuide> {
  const res = await fetch(`${API_BASE}/api/tickets/guide?route=${encodeURIComponent(route)}`);
  if (!res.ok) throw new Error(`guide ${res.status}`);
  const data = (await res.json()) as { guide: RouteGuide };
  return data.guide;
}

/** Apply a human label/weight/note. Returns the authoritative updated record. */
export async function setLabel(
  ticketId: string,
  input: { label: EvalLabel; weight?: number; note?: string },
): Promise<TicketEvaluation> {
  const res = await fetch(`${API_BASE}/api/tickets/${encodeURIComponent(ticketId)}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`evaluate ${res.status}`);
  const data = (await res.json()) as { evaluation: TicketEvaluation };
  return data.evaluation;
}

/** Toggle the bias-reflection gate. Returns the authoritative updated record. */
export async function setReflected(ticketId: string, reflected: boolean): Promise<TicketEvaluation> {
  const res = await fetch(`${API_BASE}/api/tickets/${encodeURIComponent(ticketId)}/reflect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reflected }),
  });
  if (!res.ok) throw new Error(`reflect ${res.status}`);
  const data = (await res.json()) as { evaluation: TicketEvaluation };
  return data.evaluation;
}
