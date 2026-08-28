import type { RunStore } from './runStore.js';

export interface RunRouteResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/**
 * Router for `/api/runs*`. Kept separate from httpRouter so it can be unit
 * tested without an HTTP server; httpRouter parses the body and forwards.
 * Returns null when the path is not ours, so the caller falls through.
 */
export async function handleRunRequest(
  store: RunStore,
  method: string,
  pathname: string,
  body: unknown,
): Promise<RunRouteResult | null> {
  if (method === 'GET' && pathname === '/api/runs') {
    return { status: 200, body: store.tree() };
  }

  if (method === 'POST' && pathname === '/api/runs/close') {
    const runId = readString(body, 'runId');
    const outcome = readString(body, 'outcome');
    if (!runId) return { status: 400, body: { error: 'runId required' } };
    if (!outcome || outcome.trim().length === 0) {
      return { status: 400, body: { error: 'outcome required' } };
    }
    const run = store.close(runId, outcome);
    if (!run) return { status: 404, body: { error: 'run not found' } };
    return { status: 200, body: { run } };
  }

  if (method === 'POST' && pathname === '/api/runs/abandon') {
    const runId = readString(body, 'runId');
    if (!runId) return { status: 400, body: { error: 'runId required' } };
    const run = store.abandon(runId);
    if (!run) return { status: 404, body: { error: 'run not found' } };
    return { status: 200, body: { run } };
  }

  return null;
}

function readString(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
