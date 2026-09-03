/**
 * Ticket lifecycle engine (spec §실행 파이프라인).
 *
 * Owns the queue, a concurrency semaphore, per-ticket timeouts, and the state
 * machine: queued → running → verifying → done | failed. Everything external
 * (spawning the agent, verifying, broadcasting, timers) is injected so the whole
 * machine runs deterministically in tests with no `claude` and no wall clock.
 */
import { resolve, sep } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { addUsage } from '@claude-alive/core';
import type {
  Ticket, TicketFailureReason, TicketUsage, TicketTurn,
  TicketVerification, TicketCommit, TicketDecisionPanel,
} from '@claude-alive/core';
import type { TicketStore } from './ticketStore.js';

export interface MainOutcome {
  exitCode: number | null;
  result: { result: string | null; isError: boolean; model?: string | null; usage?: TicketUsage | null } | null;
  sessionId: string | null;
  stderr: string;
}

/**
 * Split the agent's raw result into a one-line headline and the body. The main
 * agent is instructed to end with `HEADLINE: <~30 chars>`; that line is lifted
 * out for the card front and removed from the body shown in the detail modal.
 */
export function extractHeadline(raw: string | null): { headline: string | null; body: string | null } {
  if (!raw) return { headline: null, body: raw };
  const m = raw.match(/^[ \t]*HEADLINE:[ \t]*(.+?)[ \t]*$/im);
  if (!m) return { headline: null, body: raw };
  return { headline: m[1].slice(0, 80), body: raw.replace(m[0], '').trim() };
}

/**
 * Detect the `DECISION: <question>` marker the agent emits when it needs a human
 * choice to continue. When present the runner parks the ticket in `decision`
 * (awaiting a reply) instead of verifying — an asked question is not a failure.
 */
export function extractDecision(raw: string | null): { question: string | null; body: string | null } {
  if (!raw) return { question: null, body: raw };
  const m = raw.match(/^[ \t]*DECISION:[ \t]*(.+?)[ \t]*$/im);
  if (!m) return { question: null, body: raw };
  return { question: m[1].slice(0, 300), body: raw.replace(m[0], '').trim() };
}

export interface RunnerHeadlessHandle {
  kill(): void;
  done: Promise<MainOutcome>;
}

/** Options for a follow-up run that resumes a ticket's Claude session. */
export interface SpawnMainOpts {
  /** Raw follow-up text (the user's reply); when set, this replaces the goal prompt. */
  prompt?: string;
  /** Claude session id to resume so the reply continues the same conversation. */
  resumeSessionId?: string;
  /**
   * Called as soon as the agent announces its session id — long before the run
   * finishes. The runner persists it immediately so a cancelled, crashed, or
   * server-restarted run still points at a resumable thread. Waiting for the
   * final outcome would lose the id on exactly the runs that need it most.
   */
  onSessionId?: (sessionId: string) => void;
}

export interface TicketRunnerOptions {
  store: TicketStore;
  /** Spawn the autonomous main agent for a ticket. `opts` drives follow-up replies. */
  spawnMain: (ticket: Ticket, opts?: SpawnMainOpts) => RunnerHeadlessHandle;
  /** Self-verification. Rejects → fail-closed (verification-inconclusive). */
  verify: (ticket: Ticket, mainResult: string | null) => Promise<TicketVerification>;
  /**
   * Commit the work once the gate passes. Omitted = never commit (the
   * pre-feature behaviour). Errors are absorbed into the returned record — a
   * failed commit reports itself on the ticket, it never fails a passed ticket.
   */
  commitWork?: (ticket: Ticket) => Promise<TicketCommit>;
  /**
   * Ask the multi-model advisory panel to resolve a pending decision. Omitted =
   * every decision waits for the human, as before. When the panel converges the
   * runner replies on the human's behalf and the ticket resumes by itself.
   */
  adviseDecision?: (ticket: Ticket, question: string) => Promise<TicketDecisionPanel>;
  /** Push a changed ticket to clients. */
  broadcast: (ticket: Ticket) => void;
  /**
   * Fired once whenever a ticket reaches a terminal state (done/failed), from the
   * single `apply` chokepoint so every path (verify-fail, timeout, cancel, recover)
   * is covered. Used to record an evaluation. Errors are swallowed so a broken
   * consumer never wedges the runner.
   */
  onSettled?: (ticket: Ticket) => void | Promise<void>;
  /** Max tickets executing at once (§동시성). */
  concurrency?: number;
  /**
   * Per-ticket wallclock cap. OMITTED = no cap, which is the default: a ticket
   * may legitimately run for many hours, and an unattended kill destroys work
   * that has already been paid for in tokens. Set only when a hard ceiling is
   * wanted (tests do).
   */
  timeoutMs?: number;
  /** Continuation prompt for a ticket whose run a server restart cut off (resumed via --resume). */
  resumePrompt?: string;
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
  /** Existence check for a ticket's cwd; injectable for tests. Defaults to fs.existsSync. */
  cwdExists?: (path: string) => boolean;
  /**
   * Location-aware cwd validation. When provided it supersedes the local
   * cwdExists/canonicalize/allowlist path — the caller resolves an Executor from
   * the ticket's location and validates there (local fs or remote `ssh test -d`).
   * Returns an error message, or null when valid.
   */
  validateCwd?: (ticket: Ticket) => Promise<string | null>;
}

export interface TicketRunner {
  recover(): Promise<void>;
  enqueue(ticket: Ticket): void;
  retry(id: string): Promise<Ticket | undefined>;
  /** Continue a `decision` ticket with a follow-up prompt (resumes its session). */
  reply(id: string, prompt: string): Promise<Ticket | undefined>;
  cancel(id: string): Promise<Ticket | undefined>;
  activeCount(): number;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RESUME_PROMPT =
  '직전 작업이 서버 재시작으로 중단되었습니다. 지금까지의 맥락을 이어받아 목표를 끝까지 완료하세요.';

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
  const { store, spawnMain, verify, broadcast, onSettled, validateCwd, commitWork, adviseDecision } = options;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.timeoutMs;
  const resumePrompt = options.resumePrompt ?? DEFAULT_RESUME_PROMPT;
  const allowedRoots = options.allowedRoots;
  const canonicalize = options.canonicalize ?? ((p: string) => realpathSync(p));
  const cwdExists = options.cwdExists ?? existsSync;
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
    if (t) {
      broadcast(t);
      if (onSettled && isTerminal(t)) {
        // Fire-and-forget: recording an evaluation must never block or break the runner.
        Promise.resolve(onSettled(t)).catch(() => {});
      }
    }
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

  /**
   * Persist the agent's session id the moment it is announced, so the thread is
   * resumable no matter how the run ends. Idempotent: the same id arriving again
   * (init event, then the final result) writes nothing.
   */
  async function noteSession(id: string, sessionId: string): Promise<void> {
    if (!sessionId) return;
    const cur = store.get(id);
    if (!cur || cur.claudeSessionId === sessionId) return;
    await apply(id, { claudeSessionId: sessionId });
  }

  /** Register a live agent run's handle (+ cap, when configured) and route its completion. */
  function attach(id: string, handle: RunnerHeadlessHandle): void {
    handles.set(id, handle);
    // No cap by default — see TicketRunnerOptions.timeoutMs.
    if (timeoutMs !== undefined) timers.set(id, setTimer(() => void onTimeout(id), timeoutMs));
    handle.done.then(
      (outcome) => void onMainDone(id, outcome),
      (e) => void fail(id, 'error', String(e)),
    );
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

    // Validate the cwd before spawning — an invalid path would otherwise fail
    // deep in spawn as a cryptic ENOENT. When a location-aware validator is
    // injected it decides (local fs or remote `ssh test -d`); otherwise fall back
    // to the built-in local check. `cwd-not-allowed` is used for allowlist/resolve
    // failures, `error` for a missing/unreachable directory.
    if (validateCwd) {
      const err = await validateCwd(ticket);
      if (err) {
        const reason: TicketFailureReason = /allowlist|resolve/.test(err) ? 'cwd-not-allowed' : 'error';
        await fail(id, reason, err);
        return;
      }
    } else {
      if (!cwdExists(ticket.cwd)) {
        await fail(id, 'error', `working directory does not exist: ${ticket.cwd}`);
        return;
      }
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
    }

    const started = await apply(id, { state: 'running', startedAt: now() });
    if (!started) {
      releaseSlot(id);
      return;
    }

    let handle: RunnerHeadlessHandle;
    try {
      handle = spawnMain(started, { onSessionId: (sid) => void noteSession(id, sid) });
    } catch (e) {
      await fail(id, 'error', `failed to spawn agent: ${String(e)}`);
      return;
    }
    attach(id, handle);
  }

  /**
   * Resume a ticket whose run was cut off by a server restart. The `claude`
   * child process (and its stdout pipe) died with the old server, so the run
   * cannot be reattached — but the session persisted on disk, so we continue it
   * with `--resume` and a nudge to finish. Only reachable for tickets that
   * captured a session id.
   */
  async function resumeInterrupted(ticket: Ticket): Promise<void> {
    running.add(ticket.id);
    const started = await apply(ticket.id, { state: 'running', startedAt: now(), endedAt: undefined });
    if (!started) {
      releaseSlot(ticket.id);
      return;
    }
    let handle: RunnerHeadlessHandle;
    try {
      handle = spawnMain(started, {
        prompt: resumePrompt,
        resumeSessionId: ticket.claudeSessionId,
        onSessionId: (sid) => void noteSession(ticket.id, sid),
      });
    } catch (e) {
      await fail(ticket.id, 'error', `failed to resume agent: ${String(e)}`);
      return;
    }
    attach(ticket.id, handle);
  }

  async function onMainDone(id: string, outcome: MainOutcome): Promise<void> {
    clearTimer(id);
    const cur = store.get(id);
    if (isTerminal(cur)) {
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

    // Usage is cumulative across the initial run and every follow-up reply; each
    // completed agent run bumps the round counter.
    const runUsage = r.usage ?? undefined;
    const cumulativeUsage = addUsage(cur?.usage, runUsage);
    const rounds = (cur?.rounds ?? 0) + 1;
    const sessionId = outcome.sessionId ?? cur?.claudeSessionId;

    // An asked-for decision is not a failure: park the ticket awaiting a reply.
    const { question, body: decisionBody } = extractDecision(r.result);
    if (question) {
      const turn: TicketTurn = { role: 'agent', kind: 'decision', text: question, usage: runUsage, at: now() };
      await apply(id, {
        state: 'decision',
        decisionQuestion: question,
        result: decisionBody ?? undefined,
        headline: undefined,
        model: r.model ?? cur?.model,
        usage: cumulativeUsage,
        rounds,
        claudeSessionId: sessionId ?? undefined,
        turns: [...(cur?.turns ?? []), turn],
        decisionPanel: adviseDecision ? { stage: 'pending', question, opinions: [], at: now() } : undefined,
      });
      releaseSlot(id); // waiting on the human; hold no concurrency slot
      // Consult the advisory panel in the background: the ticket is already
      // parked and holds no slot, so a slow panel costs nothing and a human who
      // answers first simply wins the race (the panel's reply is then dropped).
      void consultPanel(id, question);
      return;
    }

    const { headline, body } = extractHeadline(r.result);
    const resultTurn: TicketTurn = {
      role: 'agent',
      kind: 'result',
      text: body ?? '',
      headline: headline ?? undefined,
      usage: runUsage,
      at: now(),
    };
    const verifying = await apply(id, {
      state: 'verifying',
      result: body ?? undefined,
      headline: headline ?? undefined,
      model: r.model ?? cur?.model,
      usage: cumulativeUsage,
      rounds,
      claudeSessionId: sessionId ?? undefined,
      turns: [...(cur?.turns ?? []), resultTurn],
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
        const commit = await commitVerified(verifying, verdict);
        await apply(id, {
          state: 'done',
          verification: verdict,
          ...(commit ? { commit } : {}),
          endedAt: now(),
        });
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

  /**
   * Continue a parked ticket with an answer. `by` records whether a human or the
   * advisory panel produced it, so a thread never implies the human said
   * something they did not.
   */
  async function replyInternal(id: string, prompt: string, by: 'human' | 'panel'): Promise<Ticket | undefined> {
    const t = store.get(id);
    if (!t || t.state !== 'decision') return t ?? undefined;
    const answer = prompt.trim();
    if (!answer) return t;
    if (!t.claudeSessionId) {
      // No session to resume — the reply cannot continue the conversation.
      await fail(id, 'error', 'no Claude session to resume for this reply');
      return store.get(id);
    }
    const userTurn: TicketTurn = { role: 'user', kind: 'prompt', text: answer, by, at: now() };
    running.add(id); // interactive reply re-acquires a slot immediately
    const started = await apply(id, {
      state: 'running',
      decisionQuestion: undefined,
      startedAt: now(),
      endedAt: undefined,
      turns: [...(t.turns ?? []), userTurn],
    });
    if (!started) {
      releaseSlot(id);
      return undefined;
    }
    let handle: RunnerHeadlessHandle;
    try {
      handle = spawnMain(started, {
        prompt: answer,
        resumeSessionId: t.claudeSessionId,
        onSessionId: (sid) => void noteSession(id, sid),
      });
    } catch (e) {
      await fail(id, 'error', `failed to resume agent: ${String(e)}`);
      return store.get(id);
    }
    attach(id, handle);
    return started;
  }

  /**
   * Commit a ticket whose gate just passed. A commit failure is recorded on the
   * ticket and nothing more: the work was verified, and refusing to mark it done
   * because git was unhappy would lose a passing verdict over a side effect.
   */
  async function commitVerified(ticket: Ticket, verification: TicketVerification): Promise<TicketCommit | undefined> {
    if (!commitWork) return undefined;
    if (ticket.autoCommit === false) return undefined;
    try {
      return await commitWork({ ...ticket, verification });
    } catch (e) {
      return { committed: false, skipped: `commit threw: ${String(e)}`, at: now() };
    }
  }

  /**
   * Resolve a parked decision with the advisory panel.
   *
   * Every exit re-reads the ticket before writing: the human may have answered
   * while the panel was thinking, and a late panel answer must never re-park or
   * overwrite a ticket that has already moved on.
   */
  async function consultPanel(id: string, question: string): Promise<void> {
    if (!adviseDecision) return;
    const parked = store.get(id);
    if (!parked || parked.state !== 'decision') return;
    await apply(id, { decisionPanel: { stage: 'deciding', question, opinions: [], at: now() } });

    let panel: TicketDecisionPanel;
    try {
      panel = await adviseDecision(parked, question);
    } catch (e) {
      panel = {
        stage: 'failed',
        question,
        opinions: [],
        consensus: { agree: 0, total: 0 },
        reason: e instanceof Error ? e.message : 'decision panel failed',
        at: now(),
      };
    }

    const still = store.get(id);
    if (!still || still.state !== 'decision') return; // answered by a human meanwhile
    await apply(id, { decisionPanel: panel });
    if (panel.stage === 'decided' && panel.resolution) {
      await replyInternal(id, panel.resolution, 'panel');
    }
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
          if (t.claudeSessionId) {
            // Session persisted on disk → continue it instead of failing.
            await resumeInterrupted(t);
          } else {
            // No session captured yet (died very early) → can't resume.
            await apply(t.id, {
              state: 'failed',
              failureReason: 'interrupted',
              error: 'server restarted before this ticket captured a resumable session',
              endedAt: now(),
            });
          }
        }
      }
      // A panel that was mid-flight when the server died left the ticket showing
      // "deciding" with nothing running. Hand it to the human rather than
      // silently re-polling: the first poll may already have been paid for.
      for (const t of store.list()) {
        if (t.state === 'decision' && t.decisionPanel?.stage === 'deciding') {
          await apply(t.id, {
            decisionPanel: {
              ...t.decisionPanel,
              stage: 'failed',
              reason: 'server restarted while the advisory panel was running',
            },
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
        commit: undefined,
        result: undefined,
        // A retry re-runs the goal from scratch, so accumulation resets.
        decisionQuestion: undefined,
        decisionPanel: undefined,
        turns: undefined,
        rounds: undefined,
        usage: undefined,
      });
      if (t) enqueue(t);
      return t;
    },

    reply: (id, prompt) => replyInternal(id, prompt, 'human'),

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
