/**
 * Flag-guarded spawn: never let a per-run `--model`/`--effort` kill a ticket.
 *
 * Two layers of protection, because the ticket lifecycle has three spawn paths
 * (initial start, restart-resume, decision reply) and only the first one passes
 * through cwd validation — so the guard has to live at the spawn itself:
 *
 *   1. Probe `claude --help` on the target (cached per target) and pass only the
 *      flags it advertises.
 *   2. If the run still dies with a usage error, drop the flags, invalidate the
 *      probe, and retry once. The ticket then runs with CLI defaults instead of
 *      failing.
 *
 * Requests with no flags skip the probe entirely, so the pre-feature path keeps
 * its exact previous behaviour and cost.
 */
import type { HeadlessOutcome, HeadlessRunHandle } from '../headlessClaude.js';
import {
  applyFlagSupport,
  isUnsupportedFlagError,
  type FlagSupportCache,
  type ResolvedFlags,
} from '../agentFlags.js';

export interface RequestedRunFlags {
  model?: string;
  effort?: string;
}

export interface FlagGuardedSpawnOptions {
  /** Identity of the target CLI (e.g. 'local' or 'ssh:user@host') for probe caching. */
  cacheKey: string;
  cache: FlagSupportCache;
  /** Fetch `claude --help` from the target. May reject — treated as "no support". */
  probe: () => Promise<string>;
  requested: RequestedRunFlags;
  /** Start the process with the given (already filtered) flags. */
  spawnWith: (flags: RequestedRunFlags) => HeadlessRunHandle;
  /**
   * Reports what was actually passed and what had to be dropped, once resolved.
   * Fired before the process starts; errors are swallowed so a broken consumer
   * cannot wedge a run.
   */
  onResolved?: (resolved: ResolvedFlags) => void;
}

/** Outcome used when even the fallback spawn cannot be created. */
function spawnFailureOutcome(message: string): HeadlessOutcome {
  return { exitCode: null, result: null, sessionId: null, stderr: message };
}

/**
 * Wrap a promise-of-handle in a synchronous handle. The ticket runner calls
 * `spawn()` synchronously and immediately attaches to `.done`, so the probe has
 * to happen behind a handle rather than in front of one. `done` never rejects —
 * a failure is surfaced as an outcome, matching how a dead process is reported.
 */
function deferredHandle(start: Promise<HeadlessRunHandle>): HeadlessRunHandle {
  let killed = false;
  let inner: HeadlessRunHandle | null = null;

  const done: Promise<HeadlessOutcome> = start.then(
    (handle) => {
      inner = handle;
      if (killed) handle.kill(); // kill() arrived while the probe was in flight
      return handle.done;
    },
    (e: unknown) => spawnFailureOutcome(`failed to spawn agent: ${String(e)}`),
  );

  return {
    kill: () => {
      killed = true;
      inner?.kill();
    },
    done,
  };
}

export function spawnWithFlagGuard(options: FlagGuardedSpawnOptions): HeadlessRunHandle {
  const { cacheKey, cache, probe, requested, spawnWith, onResolved } = options;

  const wantsFlags = Boolean(requested.model || requested.effort);
  if (!wantsFlags) return spawnWith({});

  const start = (async (): Promise<HeadlessRunHandle> => {
    const support = await cache.ensure(cacheKey, probe);
    const resolved = applyFlagSupport(requested, support);
    try {
      onResolved?.(resolved);
    } catch {
      // reporting is best-effort; never fail the run over it
    }

    const passed: RequestedRunFlags = {
      ...(resolved.model ? { model: resolved.model } : {}),
      ...(resolved.effort ? { effort: resolved.effort } : {}),
    };
    const handle = spawnWith(passed);
    if (!passed.model && !passed.effort) return handle;

    // Second net: the probe said yes but the CLI said no. Retry bare, once.
    const guarded: Promise<HeadlessOutcome> = handle.done.then((outcome) => {
      const failed = outcome.exitCode !== 0;
      if (!failed || !isUnsupportedFlagError(outcome.stderr)) return outcome;
      cache.invalidate(cacheKey);
      try {
        onResolved?.({ dropped: [...(passed.model ? ['--model'] : []), ...(passed.effort ? ['--effort'] : [])] });
      } catch {
        // best-effort
      }
      try {
        return spawnWith({}).done;
      } catch (e) {
        return spawnFailureOutcome(`failed to respawn agent without run flags: ${String(e)}`);
      }
    });

    return { kill: () => handle.kill(), done: guarded };
  })();

  return deferredHandle(start);
}
