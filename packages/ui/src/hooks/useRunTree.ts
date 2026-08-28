import { useCallback, useEffect, useState } from 'react';
import type { RunTree, WSServerMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../App.tsx';

const EMPTY: RunTree = { repositories: [], worktrees: [], runs: [] };

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/**
 * The run tree, seeded over HTTP and kept live over WS.
 *
 * `run:update` carries a single run, so repositories and worktrees only ever
 * arrive with a snapshot. A run whose worktree is unknown is still stored — the
 * sidebar drops it rather than crashing, and the next snapshot repairs it.
 */
export function useRunTree(active: boolean, subscribeRaw: RawMessageSubscribe) {
  const [tree, setTree] = useState<RunTree>(EMPTY);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/runs`);
        if (!res.ok) return;
        const data = (await res.json()) as RunTree;
        if (!cancelled) setTree(data);
      } catch {
        // Server not reachable: keep the empty tree; WS will fill it in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    return subscribeRaw((msg: WSServerMessage) => {
      if (msg.type === 'run:snapshot') {
        setTree(msg.tree);
        return;
      }
      if (msg.type === 'run:update') {
        setTree((prev) => {
          const runs = prev.runs.some((r) => r.runId === msg.run.runId)
            ? prev.runs.map((r) => (r.runId === msg.run.runId ? msg.run : r))
            : [...prev.runs, msg.run];
          return { ...prev, runs };
        });
      }
    });
  }, [subscribeRaw]);

  const closeRun = useCallback(async (runId: string, outcome: string): Promise<void> => {
    await fetch(`${API_BASE}/api/runs/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, outcome }),
    });
  }, []);

  const abandonRun = useCallback(async (runId: string): Promise<void> => {
    await fetch(`${API_BASE}/api/runs/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
  }, []);

  return { tree, closeRun, abandonRun };
}
