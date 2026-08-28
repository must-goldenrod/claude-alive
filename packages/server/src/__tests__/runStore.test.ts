import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunStore, type RunStore } from '../runStore.js';
import type { ResolvedLocation } from '../gitResolver.js';

const LOC: ResolvedLocation = {
  repository: { repoId: 'r1', root: '/r/proj', name: 'proj', isGit: true },
  worktree: { worktreeId: 'w1', repoId: 'r1', path: '/r/proj', branch: 'main', isPrimary: true },
};

let dir: string;
let store: RunStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runstore-'));
  store = createRunStore({ file: join(dir, 'runs.json') });
  await store.load();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function upsert(over: Partial<Parameters<RunStore['upsert']>[0]> = {}) {
  return store.upsert({
    runId: 'run-1',
    location: LOC,
    kind: 'ticket',
    sourceId: 't-1',
    title: '위임 모델 확장',
    state: 'running',
    startedAt: 1000,
    ...over,
  });
}

describe('runStore', () => {
  it('registers the repository and worktree along with the run', () => {
    upsert();
    const tree = store.tree();
    expect(tree.repositories).toHaveLength(1);
    expect(tree.worktrees).toHaveLength(1);
    expect(tree.runs[0]?.title).toBe('위임 모델 확장');
  });

  it('does not duplicate the repository across runs in one worktree', () => {
    upsert({ runId: 'run-1' });
    upsert({ runId: 'run-2', sourceId: 't-2' });
    expect(store.tree().repositories).toHaveLength(1);
    expect(store.tree().runs).toHaveLength(2);
  });

  it('close records the outcome and stamps closedAt', () => {
    upsert();
    const closed = store.close('run-1', '폴백 경로 검증 완료');
    expect(closed?.state).toBe('closed');
    expect(closed?.outcome).toBe('폴백 경로 검증 완료');
    expect(closed?.closedAt).toBeGreaterThan(0);
  });

  it('abandon marks the run without an outcome', () => {
    upsert();
    const gone = store.abandon('run-1');
    expect(gone?.state).toBe('abandoned');
    expect(gone?.outcome).toBeUndefined();
  });

  it('a later adapter report never reopens a closed run', () => {
    upsert();
    store.close('run-1', 'done');
    upsert({ state: 'running' });
    expect(store.tree().runs[0]?.state).toBe('closed');
    expect(store.tree().runs[0]?.outcome).toBe('done');
  });

  it('an adapter report still refreshes the title and meta of an open run', () => {
    upsert();
    upsert({ title: '제목 변경', state: 'waiting', meta: { model: 'opus', costUsd: 0.42 } });
    const run = store.tree().runs[0];
    expect(run?.title).toBe('제목 변경');
    expect(run?.state).toBe('waiting');
    expect(run?.meta?.costUsd).toBe(0.42);
  });

  it('notifies subscribers on upsert and close', () => {
    const seen = vi.fn();
    store.subscribe(seen);
    upsert();
    store.close('run-1', 'ok');
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('close on an unknown run returns null', () => {
    expect(store.close('nope', 'x')).toBeNull();
  });

  it('persists and reloads the tree', async () => {
    upsert();
    store.close('run-1', '기록됨');
    await store.flush();

    const reopened = createRunStore({ file: join(dir, 'runs.json') });
    await reopened.load();
    expect(reopened.tree().runs[0]?.outcome).toBe('기록됨');
    expect(reopened.tree().repositories[0]?.root).toBe('/r/proj');
  });

  it('starts empty when the file is missing or corrupt', async () => {
    const fresh = createRunStore({ file: join(dir, 'missing.json') });
    await fresh.load();
    expect(fresh.tree().runs).toEqual([]);
  });
  it('records a touched file and broadcasts it', () => {
    upsert();
    const next = store.recordTouchedFile('run-1', '/r/proj/a.ts');
    expect(next?.touchedFiles).toEqual(['/r/proj/a.ts']);
  });

  it('does not re-broadcast a path it already has', () => {
    upsert();
    const seen = vi.fn();
    store.recordTouchedFile('run-1', '/r/proj/a.ts');
    store.subscribe(seen);
    store.recordTouchedFile('run-1', '/r/proj/a.ts');
    expect(seen).not.toHaveBeenCalled();
  });

  it('keeps touched files across a later adapter report', () => {
    upsert();
    store.recordTouchedFile('run-1', '/r/proj/a.ts');
    upsert({ title: '갱신' });
    expect(store.tree().runs[0]?.touchedFiles).toEqual(['/r/proj/a.ts']);
  });

  it('recording on an unknown run returns null', () => {
    expect(store.recordTouchedFile('nope', '/a')).toBeNull();
  });
});
