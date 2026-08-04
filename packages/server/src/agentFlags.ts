/**
 * Capability detection for the target `claude` CLI.
 *
 * `--model` and `--effort` are not available on every build we may talk to — the
 * SSH executor in particular runs whatever version the remote host has installed,
 * and an unknown option makes the CLI exit immediately with a usage error. That
 * would turn "ran with the default effort" into "the ticket died", which is the
 * one outcome this feature must not introduce.
 *
 * So flags are gated on a probe of `claude --help`, cached per target. Anything we
 * cannot positively confirm is treated as unsupported: the run degrades to the
 * CLI's defaults (exactly the pre-feature behaviour) and the dropped flags are
 * recorded on the ticket so the UI never claims an effort that never happened.
 */

export interface AgentFlagSupport {
  model: boolean;
  effort: boolean;
}

/** Conservative default: pass nothing, run exactly as before. */
export const NO_FLAG_SUPPORT: AgentFlagSupport = { model: false, effort: false };

/**
 * Detect flags in `claude --help` output. Matches the flag at a word boundary so
 * `--model` is not satisfied by `--fallback-model`, which is a different option
 * and can exist without `--model` on older builds.
 */
export function parseFlagSupport(helpText: string): AgentFlagSupport {
  const has = (flag: string): boolean => new RegExp(`(?:^|[\\s,])${flag}(?=[\\s,=<]|$)`, 'm').test(helpText);
  return { model: has('--model'), effort: has('--effort') };
}

/**
 * True when a process failure looks like the CLI rejecting an option we passed.
 * Used as a second safety net behind the probe: if a target somehow accepts the
 * probe but rejects the flag, the executor retries once without it.
 */
export function isUnsupportedFlagError(stderr: string): boolean {
  return /unknown option|unrecognized option|unknown argument|invalid option/i.test(stderr);
}

/** The flags actually passable to a target, plus the ones that had to be dropped. */
export interface ResolvedFlags {
  model?: string;
  effort?: string;
  /** Requested-but-unsupported flag names, e.g. ['--effort']. */
  dropped: string[];
}

/** Intersect a requested run profile with what the target supports. */
export function applyFlagSupport(
  requested: { model?: string; effort?: string },
  support: AgentFlagSupport,
): ResolvedFlags {
  const dropped: string[] = [];
  const out: ResolvedFlags = { dropped };
  if (requested.model) {
    if (support.model) out.model = requested.model;
    else dropped.push('--model');
  }
  if (requested.effort) {
    if (support.effort) out.effort = requested.effort;
    else dropped.push('--effort');
  }
  return out;
}

export interface FlagSupportCache {
  /** Cached answer, or undefined when the target has not been probed yet. */
  get(key: string): AgentFlagSupport | undefined;
  /** Probe once per key; concurrent callers share the in-flight probe. */
  ensure(key: string, probe: () => Promise<string>): Promise<AgentFlagSupport>;
  invalidate(key: string): void;
}

/**
 * Per-target probe cache. A probe that throws or times out resolves to
 * NO_FLAG_SUPPORT rather than rejecting — a failed capability check must never
 * propagate into the ticket lifecycle.
 */
export function createFlagSupportCache(): FlagSupportCache {
  const settled = new Map<string, AgentFlagSupport>();
  const inFlight = new Map<string, Promise<AgentFlagSupport>>();

  return {
    get: (key) => settled.get(key),
    invalidate: (key) => {
      settled.delete(key);
      inFlight.delete(key);
    },
    async ensure(key, probe) {
      const cached = settled.get(key);
      if (cached) return cached;
      const running = inFlight.get(key);
      if (running) return running;

      const p = probe()
        .then((help) => parseFlagSupport(help))
        .catch(() => NO_FLAG_SUPPORT)
        .then((support) => {
          settled.set(key, support);
          inFlight.delete(key);
          return support;
        });
      inFlight.set(key, p);
      return p;
    },
  };
}
