import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRunStore, type RunStore } from '../runStore.js';
import { handleRunRequest } from '../runRoutes.js';
import type { ResolvedLocation } from '../gitResolver.js';

const LOC: ResolvedLocation = {
  repository: { repoId: 'r1', root: '/r/proj', name: 'proj', isGit: true },
  worktree: { worktreeId: 'w1', repoId: 'r1', path: '/r/proj', branch: 'main', isPrimary: true },
};

let dir: string;
let store: RunStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runroutes-'));
  store = createRunStore({ file: join(dir, 'runs.json') });
  await store.load();
  store.upsert({
    runId: 'ticket:t-1', location: LOC, kind: 'ticket', sourceId: 't-1',
    title: '위임 모델 확장', state: 'waiting', startedAt: 1000,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('handleRunRequest', () => {
  it('GET /api/runs returns the whole tree', async () => {
    const res = await handleRunRequest(store, 'GET', '/api/runs', null);
    expect(res?.status).toBe(200);
    expect(res?.body.repositories).toHaveLength(1);
    expect(res?.body.runs).toHaveLength(1);
  });

  it('POST /api/runs/close records the outcome', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/close', {
      runId: 'ticket:t-1', outcome: '폴백 검증 완료',
    });
    expect(res?.status).toBe(200);
    expect(res?.body.run.state).toBe('closed');
    expect(res?.body.run.outcome).toBe('폴백 검증 완료');
  });

  it('POST /api/runs/close rejects an empty outcome', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/close', { runId: 'ticket:t-1', outcome: '  ' });
    expect(res?.status).toBe(400);
  });

  it('POST /api/runs/close on an unknown run is 404', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/close', { runId: 'nope', outcome: 'x' });
    expect(res?.status).toBe(404);
  });

  it('POST /api/runs/abandon marks the run abandoned', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/abandon', { runId: 'ticket:t-1' });
    expect(res?.body.run.state).toBe('abandoned');
  });

  it('returns null for an unrelated path so the caller falls through', async () => {
    expect(await handleRunRequest(store, 'GET', '/api/tickets', null)).toBeNull();
  });
});
