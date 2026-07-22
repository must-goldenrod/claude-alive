import { useState, useEffect, useCallback } from 'react';
import type { Ticket, TicketEvaluation, EvalLabel, TicketLocation, WSServerMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../../App.tsx';

// Same origin convention as EfficioView: the server serves the UI and proxies in dev.
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/** Creates a ticket; resolves null on success or an error message on failure.
 * Declared here (a .ts file) so consumers avoid writing `=> Promise<…>` in a
 * .tsx file, which trips the i18n raw-text guard's JSX heuristic. */
export type TicketCreateFn = (
  goal: string,
  cwd: string,
  location?: TicketLocation,
) => Promise<string | null>;

/** Applies a human evaluation label; resolves the updated record or null on failure. */
export type EvaluateFn = (
  id: string,
  input: { label: EvalLabel; weight?: number; note?: string },
) => Promise<TicketEvaluation | null>;

/** Submits a follow-up prompt for a decision ticket; resolves true on success.
 * Named here (a .ts file) so the .tsx modal avoids an inline `=> Promise<…>`,
 * which trips the i18n raw-text guard's JSX heuristic. */
export type ReplyFn = (id: string, prompt: string) => Promise<boolean>;

export interface UseTicketsResult {
  tickets: Ticket[];
  evaluations: Record<string, TicketEvaluation>;
  loading: boolean;
  refresh: () => Promise<void>;
  createTicket: TicketCreateFn;
  retryTicket: (id: string) => Promise<boolean>;
  replyTicket: (id: string, prompt: string) => Promise<boolean>;
  cancelTicket: (id: string) => Promise<boolean>;
  deleteTicket: (id: string) => Promise<boolean>;
  evaluateTicket: EvaluateFn;
}

/**
 * Subscribes to ticket state. Initial list over HTTP (like EfficioView), live
 * changes over the shared WS (`ticket:update`). Mutations POST/DELETE and merge
 * the returned ticket optimistically so the card reacts before the broadcast.
 */
export function useTickets(active: boolean, subscribeRaw: RawMessageSubscribe): UseTicketsResult {
  const [byId, setById] = useState<Record<string, Ticket>>({});
  const [evalById, setEvalById] = useState<Record<string, TicketEvaluation>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tickets`);
      const data = (await res.json()) as { tickets: Ticket[] };
      setById(Object.fromEntries((data.tickets ?? []).map((t) => [t.id, t])));
    } catch {
      // keep whatever we have; the WS will reconcile
    } finally {
      setLoading(false);
    }
    // Evaluations are best-effort; a failure here must not block the ticket list.
    try {
      const res = await fetch(`${API_BASE}/api/evaluations`);
      const data = (await res.json()) as { evaluations: TicketEvaluation[] };
      setEvalById(Object.fromEntries((data.evaluations ?? []).map((e) => [e.ticketId, e])));
    } catch {
      // ignore — evaluation:update will reconcile
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  useEffect(() => {
    return subscribeRaw((msg: WSServerMessage) => {
      if (msg.type === 'ticket:update') {
        setById((prev) => ({ ...prev, [msg.ticket.id]: msg.ticket }));
      } else if (msg.type === 'ticket:snapshot') {
        setById(Object.fromEntries(msg.tickets.map((t) => [t.id, t])));
      } else if (msg.type === 'evaluation:update') {
        setEvalById((prev) => ({ ...prev, [msg.evaluation.ticketId]: msg.evaluation }));
      }
    });
  }, [subscribeRaw]);

  const createTicket = useCallback(async (goal: string, cwd: string, location?: TicketLocation): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(location && location.kind !== 'local' ? { goal, cwd, location } : { goal, cwd }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return body.error ?? `Request failed (${res.status})`;
      }
      const { ticket } = (await res.json()) as { ticket: Ticket };
      setById((prev) => ({ ...prev, [ticket.id]: ticket }));
      return null;
    } catch {
      return 'Network error — is the server running?';
    }
  }, []);

  const mutate = useCallback(async (id: string, path: string, method: 'POST' | 'DELETE'): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${id}${path}`, { method });
      if (!res.ok) return false;
      if (method === 'DELETE') {
        setById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        const { ticket } = (await res.json()) as { ticket: Ticket };
        setById((prev) => ({ ...prev, [ticket.id]: ticket }));
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const evaluateTicket = useCallback<EvaluateFn>(async (id, input) => {
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${id}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const { evaluation } = (await res.json()) as { evaluation: TicketEvaluation };
      setEvalById((prev) => ({ ...prev, [evaluation.ticketId]: evaluation }));
      return evaluation;
    } catch {
      return null;
    }
  }, []);

  const replyTicket = useCallback(async (id: string, prompt: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) return false;
      const { ticket } = (await res.json()) as { ticket: Ticket };
      setById((prev) => ({ ...prev, [ticket.id]: ticket }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const tickets = Object.values(byId).sort((a, b) => b.createdAt - a.createdAt);

  return {
    tickets,
    evaluations: evalById,
    loading,
    refresh,
    createTicket,
    retryTicket: (id) => mutate(id, '/retry', 'POST'),
    replyTicket,
    cancelTicket: (id) => mutate(id, '/cancel', 'POST'),
    deleteTicket: (id) => mutate(id, '', 'DELETE'),
    evaluateTicket,
  };
}
