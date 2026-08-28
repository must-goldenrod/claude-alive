import type { BackendStatus } from '@claude-alive/core';

/**
 * Backend connectivity checks used by the startup guard and the settings panel.
 *
 * Only server-defined backends (orchestrator / subagent) are probed — `location`
 * kind (SSH) is validated per-host at ticket time by design, so a startup sweep
 * would be both heavy and semantically wrong. A backend counts as a failure only
 * when the server reports `connected === false`; `undefined` means "not probed".
 */
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export interface BackendFailure {
  id: string;
  label: string;
  detail?: string;
}

/** Probe every non-location backend and return the ones that failed to connect. */
export async function checkBackendHealth(): Promise<BackendFailure[]> {
  const res = await fetch(`${API_BASE}/api/backends`);
  if (!res.ok) throw new Error(`backend list failed: ${res.status}`);
  const data = (await res.json()) as { backends?: BackendStatus[] };
  const backends = data.backends ?? [];

  const probes = backends
    .filter((b) => b.kind !== 'location')
    .map(async (b): Promise<BackendFailure | null> => {
      try {
        const r = await fetch(`${API_BASE}/api/backends/${b.id}/check`, { method: 'POST' });
        if (!r.ok) return { id: b.id, label: b.label, detail: `check failed (${r.status})` };
        const { status } = (await r.json()) as { status: BackendStatus };
        return status.connected === false
          ? { id: status.id, label: status.label, detail: status.detail }
          : null;
      } catch {
        return { id: b.id, label: b.label, detail: 'connection failed' };
      }
    });

  const results = await Promise.all(probes);
  return results.filter((f): f is BackendFailure => f !== null);
}
