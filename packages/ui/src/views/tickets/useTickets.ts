import { useState, useEffect, useCallback } from 'react';
import type { Ticket, WSServerMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../../App.tsx';

// Same origin convention as EfficioView: the server serves the UI and proxies in dev.
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/** Creates a ticket; resolves true on success. Declared here (a .ts file) so
 * consumers avoid writing `=> Promise<…>` in a .tsx file, which trips the i18n
 * raw-text guard's JSX heuristic. */
export type TicketCreateFn = (goal: string, cwd: string) => Promise<boolean>;

export interface UseTicketsResult {
  tickets: Ticket[];
  loading: boolean;
  refresh: () => Promise<void>;
  createTicket: TicketCreateFn;
  retryTicket: (id: string) => Promise<boolean>;
  cancelTicket: (id: string) => Promise<boolean>;
  deleteTicket: (id: string) => Promise<boolean>;
}

/**
 * Subscribes to ticket state. Initial list over HTTP (like EfficioView), live
 * changes over the shared WS (`ticket:update`). Mutations POST/DELETE and merge
 * the returned ticket optimistically so the card reacts before the broadcast.
 */
export function useTickets(active: boolean, subscribeRaw: RawMessageSubscribe): UseTicketsResult {
  const [byId, setById] = useState<Record<string, Ticket>>({});
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
      }
    });
  }, [subscribeRaw]);

  const createTicket = useCallback(async (goal: string, cwd: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, cwd }),
      });
      if (!res.ok) return false;
      const { ticket } = (await res.json()) as { ticket: Ticket };
      setById((prev) => ({ ...prev, [ticket.id]: ticket }));
      return true;
    } catch {
      return false;
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

  const tickets = Object.values(byId).sort((a, b) => b.createdAt - a.createdAt);

  return {
    tickets,
    loading,
    refresh,
    createTicket,
    retryTicket: (id) => mutate(id, '/retry', 'POST'),
    cancelTicket: (id) => mutate(id, '/cancel', 'POST'),
    deleteTicket: (id) => mutate(id, '', 'DELETE'),
  };
}
