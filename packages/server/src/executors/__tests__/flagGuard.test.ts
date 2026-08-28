import { describe, it, expect } from 'vitest';
import { spawnWithFlagGuard, type RequestedRunFlags } from '../flagGuard.js';
import { createFlagSupportCache, type ResolvedFlags } from '../../agentFlags.js';
import type { HeadlessOutcome, HeadlessRunHandle } from '../../headlessClaude.js';

const HELP_NEW = '  --model <model>  Model\n  --effort <level>  Effort level';
const HELP_OLD = '  --verbose  Override verbose mode';

function outcome(over: Partial<HeadlessOutcome> = {}): HeadlessOutcome {
  return { exitCode: 0, result: null, sessionId: 's1', stderr: '', ...over };
}

/** Records every flag set it is asked to spawn with. */
function recordingSpawner(outcomes: HeadlessOutcome[]) {
  const calls: RequestedRunFlags[] = [];
  let killed = 0;
  const spawnWith = (flags: RequestedRunFlags): HeadlessRunHandle => {
    calls.push(flags);
    const o = outcomes[calls.length - 1] ?? outcome();
    return { kill: () => void killed++, done: Promise.resolve(o) };
  };
  return { calls, spawnWith, killedCount: () => killed };
}

describe('spawnWithFlagGuard', () => {
  it('skips the probe entirely when no flags are requested', async () => {
    const rec = recordingSpawner([]);
    let probed = 0;
    const handle = spawnWithFlagGuard({
      cacheKey: 'local',
      cache: createFlagSupportCache(),
      probe: async () => {
        probed++;
        return HELP_NEW;
      },
      requested: {},
      spawnWith: rec.spawnWith,
    });
    await handle.done;
    expect(probed).toBe(0);
    expect(rec.calls).toEqual([{}]);
  });

  it('passes flags a supporting target advertises', async () => {
    const rec = recordingSpawner([]);
    const handle = spawnWithFlagGuard({
      cacheKey: 'local',
      cache: createFlagSupportCache(),
      probe: async () => HELP_NEW,
      requested: { model: 'opus', effort: 'max' },
      spawnWith: rec.spawnWith,
    });
    await handle.done;
    expect(rec.calls).toEqual([{ model: 'opus', effort: 'max' }]);
  });

  it('runs without flags — not failing — when the target does not support them', async () => {
    const rec = recordingSpawner([]);
    const resolved: ResolvedFlags[] = [];
    const handle = spawnWithFlagGuard({
      cacheKey: 'ssh:old-host:22',
      cache: createFlagSupportCache(),
      probe: async () => HELP_OLD,
      requested: { model: 'opus', effort: 'max' },
      spawnWith: rec.spawnWith,
      onResolved: (r) => resolved.push(r),
    });
    const result = await handle.done;
    expect(rec.calls).toEqual([{}]);
    expect(result.exitCode).toBe(0);
    expect(resolved[0]?.dropped).toEqual(['--model', '--effort']);
  });

  it('degrades instead of throwing when the probe itself fails', async () => {
    const rec = recordingSpawner([]);
    const handle = spawnWithFlagGuard({
      cacheKey: 'unreachable',
      cache: createFlagSupportCache(),
      probe: () => Promise.reject(new Error('ssh: connect failed')),
      requested: { effort: 'max' },
      spawnWith: rec.spawnWith,
    });
    const result = await handle.done;
    expect(rec.calls).toEqual([{}]);
    expect(result.exitCode).toBe(0);
  });

  it('retries once without flags when the CLI rejects the option anyway', async () => {
    const rec = recordingSpawner([
      outcome({ exitCode: 1, stderr: "error: unknown option '--effort'" }),
      outcome({ exitCode: 0, sessionId: 'retry' }),
    ]);
    const cache = createFlagSupportCache();
    const handle = spawnWithFlagGuard({
      cacheKey: 'local',
      cache,
      probe: async () => HELP_NEW,
      requested: { effort: 'max' },
      spawnWith: rec.spawnWith,
    });
    const result = await handle.done;
    expect(rec.calls).toEqual([{ effort: 'max' }, {}]);
    expect(result.exitCode).toBe(0);
    // The bad probe answer is dropped so later runs re-detect.
    expect(cache.get('local')).toBeUndefined();
  });

  it('does not retry an ordinary failure', async () => {
    const rec = recordingSpawner([outcome({ exitCode: 1, stderr: 'agent crashed' })]);
    const handle = spawnWithFlagGuard({
      cacheKey: 'local',
      cache: createFlagSupportCache(),
      probe: async () => HELP_NEW,
      requested: { effort: 'max' },
      spawnWith: rec.spawnWith,
    });
    const result = await handle.done;
    expect(rec.calls).toHaveLength(1);
    expect(result.exitCode).toBe(1);
  });

  it('surfaces a spawn throw as an outcome rather than rejecting', async () => {
    const handle = spawnWithFlagGuard({
      cacheKey: 'local',
      cache: createFlagSupportCache(),
      probe: async () => HELP_NEW,
      requested: { effort: 'max' },
      spawnWith: () => {
        throw new Error('ENOENT');
      },
    });
    const result = await handle.done;
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('ENOENT');
  });

  it('kills the process even when kill() lands during the probe', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const rec = recordingSpawner([]);
    const handle = spawnWithFlagGuard({
      cacheKey: 'local',
      cache: createFlagSupportCache(),
      probe: async () => {
        await gate;
        return HELP_NEW;
      },
      requested: { effort: 'max' },
      spawnWith: rec.spawnWith,
    });
    handle.kill(); // before the probe resolves
    release();
    await handle.done;
    expect(rec.killedCount()).toBe(1);
  });
});
