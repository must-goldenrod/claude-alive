import { beforeEach, describe, expect, test } from 'vitest';
import type { WorkspaceIdentity } from '@claude-alive/core';
import { openDatabase, type Database } from '../db.js';
import { runMigrations } from '../migrator.js';
import { WorkspaceStore } from '../workspaceStore.js';

const identity = (over: Partial<WorkspaceIdentity> = {}): WorkspaceIdentity => ({
  workspaceId: 'WS_NEW',
  locationId: 'local',
  rootPath: '/repo/alpha',
  kind: 'git',
  displayName: 'alpha',
  ...over,
});

let db: Database;
let store: WorkspaceStore;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  store = new WorkspaceStore(db);
});

describe('upsert / resolve', () => {
  test('stores a new workspace and returns it', () => {
    const ws = store.upsert(identity());
    expect(ws.workspaceId).toBe('WS_NEW');
    expect(store.count()).toBe(1);
  });

  test('the same (location, rootPath) keeps its original id', () => {
    const first = store.upsert(identity({ workspaceId: 'WS_1' }));
    const second = store.upsert(identity({ workspaceId: 'WS_2' })); // freshly minted id
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(store.count()).toBe(1);
  });

  test('the same path under a different location is a different workspace', () => {
    store.upsert(identity({ workspaceId: 'WS_LOCAL', locationId: 'local' }));
    const remote = store.upsert(identity({ workspaceId: 'WS_SSH', locationId: 'ssh-gpu' }));
    expect(remote.workspaceId).toBe('WS_SSH');
    expect(store.count()).toBe(2);
  });

  test('survives a restart: a new store over the same database reuses the id', () => {
    const first = store.upsert(identity({ workspaceId: 'WS_ORIGINAL' }));
    const afterRestart = new WorkspaceStore(db).upsert(identity({ workspaceId: 'WS_REGENERATED' }));
    expect(afterRestart.workspaceId).toBe(first.workspaceId);
    expect(new WorkspaceStore(db).count()).toBe(1);
  });
});

describe('identity round-trip', () => {
  test('preserves repository details', () => {
    store.upsert(
      identity({
        repo: { remoteUrlNormalized: 'https://github.com/acme/widgets', host: 'github.com', owner: 'acme', name: 'widgets' },
      }),
    );
    const found = store.find('local', '/repo/alpha')!;
    expect(found.repo).toEqual({
      remoteUrlNormalized: 'https://github.com/acme/widgets',
      host: 'github.com',
      owner: 'acme',
      name: 'widgets',
    });
  });

  test('preserves a folder workspace with no repository', () => {
    store.upsert(identity({ kind: 'folder', repo: undefined }));
    const found = store.find('local', '/repo/alpha')!;
    expect(found.kind).toBe('folder');
    expect(found.repo).toBeUndefined();
  });

  test('preserves a user-set custom name', () => {
    store.upsert(identity({ customName: 'My Project', displayName: 'My Project' }));
    expect(store.find('local', '/repo/alpha')!.customName).toBe('My Project');
  });

  test('find returns undefined for an unknown workspace', () => {
    expect(store.find('local', '/nope')).toBeUndefined();
  });

  test('later probes refresh mutable details without changing the id', () => {
    const first = store.upsert(identity({ workspaceId: 'WS_1', displayName: 'alpha' }));
    store.upsert(identity({ workspaceId: 'WS_2', displayName: 'widgets', kind: 'git' }));
    const found = store.find('local', '/repo/alpha')!;
    expect(found.workspaceId).toBe(first.workspaceId);
    expect(found.displayName).toBe('widgets');
  });
});
