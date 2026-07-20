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
