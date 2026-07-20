/**
 * Reads one session's dialogue from `/api/v2/sessions/:id/conversation` (§F.7).
 *
 * Clicking a session opens its conversation; it does not resume the session.
 * Reading is therefore always safe, and the three "nothing to show" causes are
 * kept apart: an unknown session (404), an unreadable log (503), and a network
 * failure. Collapsing them would tell the user "no messages" when the truth is
 * "we could not look" (§C.10).
 */

import { useEffect, useState } from 'react';

export interface ConversationItem {
  itemId: string;
  kind: 'user' | 'assistant' | 'reasoning' | 'tool-call' | 'approval' | 'artifact' | 'system-event';
  occurredAt: number;
  confidence: string;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  approvalId?: string;
  decision?: string;
  status?: 'running' | 'completed' | 'failed';
  detail?: string;
}

export interface UseConversationResult {
  items: ConversationItem[];
  loading: boolean;
  /** The session id is not in the catalog. */
  notFound: boolean;
  /** The canonical log itself cannot be read. */
  unavailable: boolean;
  error: string | null;
  /** How complete this history is; `hook-derived` means partial by construction. */
  completeness: string | null;
}

const EMPTY: ConversationItem[] = [];

export function useConversation(sessionId: string | null): UseConversationResult {
  const [items, setItems] = useState<ConversationItem[]>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setItems(EMPTY);
      setLoading(false);
      setNotFound(false);
      setUnavailable(false);
      setError(null);
      setCompleteness(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setUnavailable(false);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/v2/sessions/${encodeURIComponent(sessionId)}/conversation`);
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          setItems(EMPTY);
          return;
        }
        if (res.status === 503) {
          setUnavailable(true);
          setItems(EMPTY);
          return;
        }
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setItems(EMPTY);
          return;
        }
        const page = (await res.json()) as { items: ConversationItem[]; completeness?: string };
        if (cancelled) return;
        setItems(page.items ?? EMPTY);
        setCompleteness(page.completeness ?? null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setItems(EMPTY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { items, loading, notFound, unavailable, error, completeness };
}
