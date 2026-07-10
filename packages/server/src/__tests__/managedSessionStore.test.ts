import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The store computes its file path from os.homedir(), which respects $HOME on
 * POSIX. Each test points HOME at a fresh temp dir and re-imports the module so
 * its in-memory cache starts empty.
 */
type StoreModule = typeof import('../managedSessionStore.js');

async function freshStore(home: string): Promise<StoreModule> {
  process.env.HOME = home;
  vi.resetModules();
  return import('../managedSessionStore.js');
}

function record(tabId: string, lastActive: number) {
  return {
    tabId,
    claudeSessionId: `sid-${tabId}`,
    cwd: '/proj',
    displayName: tabId,
    mode: 'claude' as const,
    claudeVariant: 'claude' as const,
    createdAt: lastActive,
    lastActive,
  };
}

describe('managedSessionStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cas-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.HOME;
  });

  it('persists and reloads records', async () => {
    const s1 = await freshStore(dir);
    await s1.saveManagedSession(record('T1', 100));
    await s1.saveManagedSession(record('T2', 200));

    // A second load (simulating a restart) sees the persisted records.
    const s2 = await freshStore(dir);
    await s2.loadManagedSessions();
    const ids = s2.getManagedSessionIds().sort();
    expect(ids).toEqual(['sid-T1', 'sid-T2']);
    expect(s2.getManagedSession('T1')?.claudeSessionId).toBe('sid-T1');
  });

  it('orders resumable sessions by most-recent activity', async () => {
    const s = await freshStore(dir);
    await s.saveManagedSession(record('old', 100));
    await s.saveManagedSession(record('new', 999));
    const resumable = s.toResumableSessions();
    expect(resumable[0]!.tabId).toBe('new');
    expect(resumable[1]!.tabId).toBe('old');
  });

  it('removes a record on close', async () => {
    const s = await freshStore(dir);
    await s.saveManagedSession(record('T1', 100));
    await s.removeManagedSession('T1');
    expect(s.getManagedSession('T1')).toBeUndefined();
    expect(s.getManagedSessionIds()).toEqual([]);
  });

  it('degrades to empty on a corrupt file', async () => {
    mkdirSync(join(dir, '.claude-alive'), { recursive: true });
    writeFileSync(join(dir, '.claude-alive', 'managed-sessions.json'), '{ not json');
    const s = await freshStore(dir);
    await s.loadManagedSessions();
    expect(s.getManagedSessions()).toEqual([]);
  });

  it('touch updates lastActive without losing the record', async () => {
    const s = await freshStore(dir);
    await s.saveManagedSession(record('T1', 100));
    await s.touchManagedSession('T1', 500);
    expect(s.getManagedSession('T1')?.lastActive).toBe(500);
  });
});
