/**
 * Reads the server-owned canonical catalog (§I.5) from `/api/v2/workspace-tree`.
 *
 * Deliberately distinguishes three outcomes that a naive hook would collapse
 * into "empty": loaded-and-empty, the log being unavailable (503), and a network
 * failure. Showing "no sessions" when the truth is "cannot read" would be the
 * silent-loss failure mode the spec forbids (§C.10).
 *
 * Updates on a `v2:catalog-changed` signal from the existing socket when one is
 * supplied, and keeps a slow poll as a safety net so a dropped signal degrades to
 * a delay rather than a permanently stale view.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface TreeSession {
  sessionId: string;
  provider: string;
  providerSessionId?: string;
  title: string;
  titleSource: string;
  firstPromptPreview?: string;
  state: string;
  stateConfidence: string;
  currentTool?: string;
  pendingApprovals: number;
  lastActiveAt: number;
}

export interface TreeWorkspace {
  workspace: {
    workspaceId: string;
    locationId: string;
    rootPath: string;
    kind: 'git' | 'folder';
    displayName: string;
    repo?: { name: string; host?: string; owner?: string; remoteUrlNormalized?: string };
  };
  sessions: TreeSession[];
}

export interface WorkspaceTree {
  locations: Array<{
    location: { locationId: string; kind: string; displayName: string; status: string };
    workspaces: TreeWorkspace[];
  }>;
}

export interface UseWorkspaceTreeResult {
  tree: WorkspaceTree | null;
  loading: boolean;
  /** The server has no canonical log to read (503) — not the same as empty. */
  unavailable: boolean;
  error: string | null;
  refresh: () => void;
}

const POLL_MS = 5_000;

export interface UseWorkspaceTreeOptions {
  active?: boolean;
  /** Raw socket subscription; the hook refetches on `v2:catalog-changed`. */
  subscribeRaw?: (handler: (msg: unknown) => void) => () => void;
}

export function useWorkspaceTree(options: UseWorkspaceTreeOptions = {}): UseWorkspaceTreeResult {
  const active = options.active ?? true;
  const { subscribeRaw } = options;
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [loading, setLoading] = useState(active);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const cancelled = useRef(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!active) return;
    cancelled.current = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/v2/workspace-tree');
        if (cancelled.current) return;
        if (res.status === 503) {
          setUnavailable(true);
          setTree(null);
          setError(null);
          return;
        }
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setTree(null);
          return;
        }
        setTree((await res.json()) as WorkspaceTree);
        setUnavailable(false);
        setError(null);
      } catch (e) {
        if (cancelled.current) return;
        // A failed read is an error, never an empty tree.
        setError(e instanceof Error ? e.message : String(e));
        setTree(null);
      } finally {
        if (!cancelled.current) setLoading(false);
      }
    }

    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, [active, nonce]);

  // Server-pushed invalidation. The payload is only a signal — the tree itself is
  // fetched over HTTP so the socket protocol does not have to carry (and version)
  // the whole read model.
  useEffect(() => {
    if (!active || !subscribeRaw) return;
    return subscribeRaw((msg) => {
      if ((msg as { type?: string } | null)?.type === 'v2:catalog-changed') refresh();
    });
  }, [active, subscribeRaw, refresh]);

  return { tree, loading, unavailable, error, refresh };
}
