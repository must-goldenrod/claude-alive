import { describe, expect, test, vi } from 'vitest';
import type { HookEventName, HookEventPayload } from '@claude-alive/core';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { createCanonicalPipeline } from '../canonicalPipeline.js';

const SID = 'claude-sess-1';
const CWD = '/repo/alpha';

let t = 0;
function hook(event: HookEventName, data: Partial<HookEventPayload['data']> = {}): HookEventPayload {
  t += 10;
  return {
    event,
    tool: data.tool_name ?? '',
    session_id: SID,
    timestamp: 1_700_000_000_000 + t,
    data: { session_id: SID, hook_event_name: event, cwd: CWD, ...data },
  };
}

/** git fake: every path is a repo root with no remote. */
const gitRunner = async (command: string, args: string[]) => {
  if (command === 'git' && args.includes('rev-parse')) {
    return { ok: true, stdout: `${args[1]}\n` };
  }
  return { ok: false, stdout: '', error: 'no remote' };
};

function make(overrides: Parameters<typeof createCanonicalPipeline>[0] = {}) {
  return createCanonicalPipeline({ dbPath: ':memory:', runner: gitRunner, ...overrides });
}

describe('createCanonicalPipeline', () => {
  test('is enabled when the database opens', () => {
    const p = make();
    expect(p.enabled).toBe(true);
    p.close();
  });

  test('persists canonical events for an ingested hook', async () => {
    t = 0;
    const p = make();
    await p.ingest(hook('SessionStart'));
    await p.ingest(hook('UserPromptSubmit', { prompt: 'do the thing' }));
    await p.drain();
    expect(p.stats().events).toBeGreaterThan(0);
    p.close();
  });

  test('maps the provider session to one stable Alive id', async () => {
    t = 0;
    const p = make();
    await p.ingest(hook('SessionStart'));
    await p.ingest(hook('UserPromptSubmit', { prompt: 'x' }));
    await p.drain();
    expect(p.stats().sessions).toBe(1);
    p.close();
  });

  test('a redelivered hook does not duplicate stored events', async () => {
    t = 0;
    const p = make();
    const h = hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1' });
    await p.ingest(h);
    await p.drain();
    const first = p.stats().events;
    await p.ingest(h); // exact redelivery
    await p.drain();
    expect(p.stats().events).toBe(first);
    p.close();
  });

  test('probes each working directory only once', async () => {
    t = 0;
    const probe = vi.fn(gitRunner);
    const p = make({ runner: probe });
    await p.ingest(hook('SessionStart'));
    await p.ingest(hook('UserPromptSubmit', { prompt: 'a' }));
    await p.ingest(hook('Stop'));
    await p.drain();
    const rootCalls = probe.mock.calls.filter((c) => c[1].includes('rev-parse')).length;
    expect(rootCalls).toBe(1);
    p.close();
  });

  test('records the resolved workspace on the stored events', async () => {
    t = 0;
    const p = make();
    await p.ingest(hook('SessionStart'));
    await p.drain();
    expect(p.stats().workspaces).toBe(1);
    p.close();
  });
});

describe('workspace identity survives a restart', () => {
  test('a second pipeline over the same database reuses the workspace id', async () => {
    // Regression: the identity used to live only in memory, so every restart
    // minted a new ULID and the same repository appeared as two workspaces —
    // breaking "one session appears exactly once under its workspace".
    const dbPath = join(tmpdir(), `alive-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      t = 0;
      const first = make({ dbPath });
      await first.ingest(hook('SessionStart'));
      await first.drain();
      first.close();

      const second = make({ dbPath });
      await second.ingest(hook('SessionStart', {}));
      await second.drain();
      expect(second.stats().workspaces).toBe(1);
      second.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(dbPath + suffix);
        } catch {
          // Absent WAL sidecars are fine.
        }
      }
    }
  });
});

describe('workspace tree — the server-owned catalog (§I.5)', () => {
  test('groups sessions under their workspace and location', async () => {
    t = 0;
    const p = make();
    await p.ingest(hook('SessionStart'));
    await p.ingest(hook('UserPromptSubmit', { prompt: 'refactor the auth module' }));
    await p.drain();

    const tree = p.tree();
    expect(tree.locations).toHaveLength(1);
    expect(tree.locations[0].location.kind).toBe('local');
    expect(tree.locations[0].workspaces).toHaveLength(1);
    expect(tree.locations[0].workspaces[0].sessions).toHaveLength(1);
    p.close();
  });

  test('titles a session from its first prompt', async () => {
    t = 0;
    const p = make();
    await p.ingest(hook('SessionStart'));
    await p.ingest(hook('UserPromptSubmit', { prompt: 'refactor the auth module' }));
    await p.ingest(hook('UserPromptSubmit', { prompt: 'a much later prompt' }));
    await p.drain();

    const session = p.tree().locations[0].workspaces[0].sessions[0];
    expect(session.titleSource).toBe('first-prompt');
    expect(session.title).toBe('refactor t…');
    expect(session.firstPromptPreview).toBe('refactor the auth module');
    p.close();
  });

  test('exposes the provider session id and live state', async () => {
    t = 0;
    const p = make();
    await p.ingest(hook('SessionStart'));
    await p.ingest(hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1' }));
    await p.drain();

    const session = p.tree().locations[0].workspaces[0].sessions[0];
    expect(session.providerSessionId).toBe(SID);
    expect(session.provider).toBe('claude');
    expect(session.state).toBe('using-tool');
    p.close();
  });

  test('a session appears exactly once in the tree', async () => {
    t = 0;
    const p = make();
    for (const h of [hook('SessionStart'), hook('UserPromptSubmit', { prompt: 'x' }), hook('Stop')]) {
      await p.ingest(h);
    }
    await p.drain();
    const all = p.tree().locations.flatMap((l) => l.workspaces.flatMap((w) => w.sessions));
    expect(all).toHaveLength(1);
    p.close();
  });

  test('rebuilds the projection from the log after a restart', async () => {
    const dbPath = join(tmpdir(), `alive-tree-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      t = 0;
      const first = make({ dbPath });
      await first.ingest(hook('SessionStart'));
      await first.ingest(hook('UserPromptSubmit', { prompt: 'survive the restart' }));
      await first.drain();
      first.close();

      // A fresh pipeline sees no new events; the tree must come from the log.
      const second = make({ dbPath });
      const session = second.tree().locations[0].workspaces[0].sessions[0];
      expect(session.firstPromptPreview).toBe('survive the restart');
      second.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(dbPath + suffix);
        } catch {
          // Absent WAL sidecars are fine.
        }
      }
    }
  });

  test('an empty log yields an empty tree, not an error', () => {
    const p = make();
    expect(p.tree().locations.flatMap((l) => l.workspaces)).toEqual([]);
    p.close();
  });
});

describe('legacy import — existing sessions appear in the new tree', () => {
  const legacy = (over: Partial<Parameters<CanonicalPipeline['importLegacySessions']>[0][number]> = {}) => ({
    tabId: 'tab-8',
    claudeSessionId: 'de71b20f-legacy',
    cwd: CWD,
    mode: 'claude' as const,
    claudeVariant: 'claude' as const,
    createdAt: 1_700_000_000_000,
    lastActive: 1_700_000_001_000,
    ...over,
  });

  test('a persisted managed session becomes a session in the tree', async () => {
    const p = make();
    const result = await p.importLegacySessions([legacy()]);
    expect(result.imported).toBe(1);
    const sessions = p.tree().locations.flatMap((l) => l.workspaces.flatMap((w) => w.sessions));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].providerSessionId).toBe('de71b20f-legacy');
    p.close();
  });

  test('importing twice does not duplicate the session', async () => {
    const p = make();
    await p.importLegacySessions([legacy()]);
    const second = await p.importLegacySessions([legacy()]);
    expect(second.imported).toBe(0);
    expect(p.tree().locations.flatMap((l) => l.workspaces.flatMap((w) => w.sessions))).toHaveLength(1);
    p.close();
  });

  test('a legacy session and a live hook for the same id stay one session', async () => {
    t = 0;
    const p = make();
    await p.importLegacySessions([legacy({ claudeSessionId: SID })]);
    await p.ingest(hook('SessionStart'));
    await p.drain();
    expect(p.tree().locations.flatMap((l) => l.workspaces.flatMap((w) => w.sessions))).toHaveLength(1);
    p.close();
  });

  test('a user-set display name becomes the session title', async () => {
    const p = make();
    await p.importLegacySessions([legacy({ displayName: 'Auth refactor' })]);
    const session = p.tree().locations[0].workspaces[0].sessions[0];
    expect(session.title).toBe('Auth refactor');
    expect(session.titleSource).toBe('manual');
    p.close();
  });

  test('records skipped records instead of dropping them silently', async () => {
    const p = make();
    const result = await p.importLegacySessions([legacy({ cwd: undefined }), legacy({ mode: 'shell' })]);
    expect(result.imported).toBe(0);
    expect(result.skipped.length).toBe(2);
    p.close();
  });

  test('is a no-op on a disabled pipeline', async () => {
    const p = createCanonicalPipeline({ dbPath: '/nonexistent-dir-xyz/alive.db', runner: gitRunner });
    await expect(p.importLegacySessions([legacy()])).resolves.toMatchObject({ imported: 0 });
    p.close();
  });
});

describe('failure isolation — the hook path must never break', () => {
  test('an unopenable database disables the pipeline instead of throwing', () => {
    const p = createCanonicalPipeline({ dbPath: '/nonexistent-dir-xyz/alive.db', runner: gitRunner });
    expect(p.enabled).toBe(false);
    expect(() => p.close()).not.toThrow();
  });

  test('ingest on a disabled pipeline is a silent no-op', async () => {
    const p = createCanonicalPipeline({ dbPath: '/nonexistent-dir-xyz/alive.db', runner: gitRunner });
    await expect(p.ingest(hook('SessionStart'))).resolves.toBeUndefined();
    p.close();
  });

  test('a throwing workspace probe does not reject the ingest', async () => {
    t = 0;
    const p = make({
      runner: async () => {
        throw new Error('git exploded');
      },
    });
    await expect(p.ingest(hook('SessionStart'))).resolves.toBeUndefined();
    await p.drain();
    p.close();
  });
});
