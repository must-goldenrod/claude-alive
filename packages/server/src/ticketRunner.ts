/**
 * Ticket lifecycle engine (spec §실행 파이프라인).
 *
 * Owns the queue, a concurrency semaphore, per-ticket timeouts, and the state
 * machine: queued → running → verifying → done | failed. Everything external
 * (spawning the agent, verifying, broadcasting, timers) is injected so the whole
 * machine runs deterministically in tests with no `claude` and no wall clock.
 */
import { resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { Ticket, TicketFailureReason } from '@claude-alive/core';
import type { TicketStore } from './ticketStore.js';

export interface MainOutcome {
  exitCode: number | null;
  result: { result: string | null; isError: boolean } | null;
  sessionId: string | null;
  stderr: string;
}

export interface RunnerHeadlessHandle {
  kill(): void;
  done: Promise<MainOutcome>;
}

export interface TicketRunnerOptions {
  store: TicketStore;
  /** Spawn the autonomous main agent for a ticket. */
  spawnMain: (ticket: Ticket) => RunnerHeadlessHandle;
  /** Self-verification. Rejects → fail-closed (verification-inconclusive). */
  verify: (ticket: Ticket, mainResult: string | null) => Promise<{ passed: boolean; reason: string }>;
  /** Push a changed ticket to clients. */
  broadcast: (ticket: Ticket) => void;
  /** Max tickets executing at once (§동시성). */
  concurrency?: number;
  /** Per-ticket wallclock cap. */
  timeoutMs?: number;
  /** cwd allowlist; empty = unrestricted. A ticket outside it fails immediately. */
  allowedRoots?: string[];
  now?: () => number;
  /** Injectable timer (returns a clear fn) for deterministic timeout tests. */
  setTimer?: (cb: () => void, ms: number) => () => void;
  /**
   * Canonicalize a cwd before the allowlist check (resolves symlinks). Only
   * invoked when allowedRoots is non-empty. Throwing = reject (fail-closed).
   * Defaults to fs.realpathSync; injectable so tests stay hermetic.
   */
  canonicalize?: (path: string) => string;
}

export interface TicketRunner {
  recover(): Promise<void>;
  enqueue(ticket: Ticket): void;
  retry(id: string): Promise<Ticket | undefined>;
  cancel(id: string): Promise<Ticket | undefined>;
  activeCount(): number;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * True when cwd is within some allowed root. Empty roots = unrestricted.
 *
 * Hardened against allowlist bypass: a `..` segment is rejected outright, and
 * both sides are normalized with path.resolve so a crafted relative path cannot
 * escape a root by prefix trickery (e.g. `/allowed-evil` vs root `/allowed`).
 */
export function isCwdAllowed(cwd: string, roots: readonly string[] | undefined): boolean {
  if (!roots || roots.length === 0) return true;
  if (cwd.split(/[\\/]+/).includes('..')) return false;
  const target = resolve(cwd);
  return roots.some((root) => {
    const r = resolve(root);
    const base = r.endsWith(sep) ? r : r + sep;
    return target === r || target.startsWith(base);
  });
}

function isTerminal(t: Ticket | undefined): boolean {
  return !!t && (t.state === 'done' || t.state === 'failed');
}

export function createTicketRunner(options: TicketRunnerOptions): TicketRunner {
  const { store, spawnMain, verify, broadcast } = options;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowedRoots = options.allowedRoots;
  const canonicalize = options.canonicalize ?? ((p: string) => realpathSync(p));
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((cb, ms) => {
      const t = setTimeout(cb, ms);
      return () => clearTimeout(t);
    });

  const running = new Set<string>();
  const queue: string[] = [];
  const handles = new Map<string, RunnerHeadlessHandle>();
  const timers = new Map<string, () => void>();

  async function apply(id: string, patch: Partial<Ticket>): Promise<Ticket | undefined> {
    const t = await store.update(id, patch);
    if (t) broadcast(t);
    return t;
  }

  function clearTimer(id: string): void {
    const c = timers.get(id);
    if (c) {
      c();
      timers.delete(id);
    }
  }

  function releaseSlot(id: string): void {
    running.delete(id);
    handles.delete(id);
    clearTimer(id);
    pump();
  }

  async function fail(id: string, reason: TicketFailureReason, error: string, verification?: Ticket['verification']): Promise<void> {
    await apply(id, { state: 'failed', failureReason: reason, error, verification, endedAt: now() });
    releaseSlot(id);
  }

  function pump(): void {
    while (running.size < concurrency && queue.length > 0) {
      const id = queue.shift()!;
      void start(id);
    }
  }

  async function start(id: string): Promise<void> {
    const ticket = store.get(id);
    if (!ticket || ticket.state !== 'queued') return;
    running.add(id); // reserve the slot synchronously so pump() can't oversubscribe

    // Canonicalize (resolve symlinks) before the allowlist check when a list is
    // set; a path that fails to resolve is rejected (fail-closed).
    let checkCwd = ticket.cwd;
    if (allowedRoots && allowedRoots.length > 0) {
      try {
        checkCwd = canonicalize(ticket.cwd);
      } catch {
        await fail(id, 'cwd-not-allowed', `cwd does not resolve: ${ticket.cwd}`);
        return;
      }
    }
    if (!isCwdAllowed(checkCwd, allowedRoots)) {
      await fail(id, 'cwd-not-allowed', `cwd not in allowlist: ${ticket.cwd}`);
      return;
    }

    const started = await apply(id, { state: 'running', startedAt: now() });
    if (!started) {
      releaseSlot(id);
      return;
    }

    let handle: RunnerHeadlessHandle;
    try {
      handle = spawnMain(started);
    } catch (e) {
      await fail(id, 'error', `failed to spawn agent: ${String(e)}`);
      return;
    }
    handles.set(id, handle);
    timers.set(id, setTimer(() => void onTimeout(id), timeoutMs));
    handle.done.then(
      (outcome) => void onMainDone(id, outcome),
      (e) => void fail(id, 'error', String(e)),
    );
  }

  async function onMainDone(id: string, outcome: MainOutcome): Promise<void> {
    clearTimer(id);
    if (isTerminal(store.get(id))) {
      releaseSlot(id);
      return;
    }
    const r = outcome.result;
    const ok = outcome.exitCode === 0 && r != null && !r.isError;
    if (!ok) {
      const msg =
        outcome.stderr.trim() ||
        (outcome.exitCode === null ? 'failed to spawn claude' : `main agent exited (code ${outcome.exitCode})`);
      await fail(id, 'error', msg);
      return;
    }

    const verifying = await apply(id, {
      state: 'verifying',
      result: r.result ?? undefined,
      claudeSessionId: outcome.sessionId ?? undefined,
    });
    if (!verifying) {
      releaseSlot(id);
      return;
    }

    try {
      const verdict = await verify(verifying, r.result);
      if (isTerminal(store.get(id))) {
        // Cancelled/aborted while verifying — respect the terminal state.
        releaseSlot(id);
        return;
      }
      if (verdict.passed) {
        await apply(id, { state: 'done', verification: verdict, endedAt: now() });
        releaseSlot(id);
      } else {
        await fail(id, 'verification-failed', verdict.reason || 'goal not met', verdict);
      }
    } catch {
      if (store.get(id)?.state === 'verifying') {
        await fail(id, 'verification-inconclusive', 'verification could not be completed');
      } else {
        releaseSlot(id);
      }
    }
  }

  async function onTimeout(id: string): Promise<void> {
    if (isTerminal(store.get(id))) return;
    handles.get(id)?.kill();
    await fail(id, 'timeout', 'exceeded wallclock timeout');
  }

  function enqueue(ticket: Ticket): void {
    if (running.has(ticket.id) || queue.includes(ticket.id)) return;
    queue.push(ticket.id);
    pump();
  }

  return {
    async recover() {
      for (const t of store.list()) {
        if (t.state === 'running' || t.state === 'verifying') {
          await apply(t.id, {
            state: 'failed',
            failureReason: 'interrupted',
            error: 'server restarted while this ticket was in flight',
            endedAt: now(),
          });
        }
      }
      // Re-enqueue anything still queued so a restart resumes the backlog.
      for (const t of store.list()) {
        if (t.state === 'queued') enqueue(t);
      }
    },

    enqueue,

    async retry(id) {
      const cur = store.get(id);
      if (!cur) return undefined;
      if (cur.state !== 'failed') return cur;
      const t = await apply(id, {
        state: 'queued',
        startedAt: undefined,
        endedAt: undefined,
        error: undefined,
        failureReason: undefined,
        verification: undefined,
        result: undefined,
      });
      if (t) enqueue(t);
      return t;
    },

    async cancel(id) {
      const cur = store.get(id);
      if (!cur) return undefined;
      if (isTerminal(cur)) return cur;
      handles.get(id)?.kill();
      const qi = queue.indexOf(id);
      if (qi >= 0) queue.splice(qi, 1);
      const t = await apply(id, { state: 'failed', failureReason: 'cancelled', error: 'cancelled by user', endedAt: now() });
      releaseSlot(id);
      return t;
    },

    activeCount() {
      return running.size;
    },
  };
}
