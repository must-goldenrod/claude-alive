/**
 * Execution backend abstraction (spec 2026-07-22 §3).
 *
 * An Executor knows how to validate a working directory and spawn a headless
 * agent for it. `LocalExecutor` runs `claude` as a local child process;
 * `SshExecutor` runs it on a remote host over SSH. The ticket runner is written
 * against this interface, so the same lifecycle/verification/eval machinery works
 * regardless of where the agent runs — and a future codex/litellm/hermes backend
 * plugs in here.
 */
import type { HeadlessRunHandle } from '../headlessClaude.js';
import type { ResolvedFlags } from '../agentFlags.js';

export interface AgentSpawnRequest {
  /** Full prompt (already includes any learned guide + the HEADLINE instruction). */
  goal: string;
  /** Working directory — local path for LocalExecutor, remote path for SshExecutor. */
  cwd: string;
  /** Privileged mode, passed explicitly from trusted server config. */
  permissionMode: string;
  /** Resume a prior Claude session (`--resume <id>`) so a follow-up continues the thread. */
  resumeSessionId?: string;
  /** Dir prepended to the agent PATH (local only) so an orchestrator can call `ca-delegate`. */
  pathPrepend?: string;
  /** Extra env vars for the agent process (e.g. CA_TICKET_ID for delegation tagging). */
  extraEnv?: Record<string, string>;
  /**
   * Requested model/effort for this run (resolved from the ticket's preset). The
   * executor probes the target CLI and silently drops anything it cannot accept —
   * an unsupported flag degrades the run, it never fails it.
   */
  run?: { model?: string; effort?: string };
  /**
   * Reports which requested flags actually reached the CLI and which were dropped.
   * Called once the executor has resolved capabilities, before the process starts.
   */
  onFlagsResolved?: (resolved: ResolvedFlags) => void;
}

export interface Executor {
  /** Confirm the cwd is usable. Returns an error message, or null when valid. */
  validateCwd(cwd: string): Promise<string | null>;
  /** Spawn the headless agent. Returns a handle with `kill()` + `done`. */
  spawn(req: AgentSpawnRequest): HeadlessRunHandle;
}
