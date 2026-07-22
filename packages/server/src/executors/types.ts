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

export interface AgentSpawnRequest {
  /** Full prompt (already includes any learned guide + the HEADLINE instruction). */
  goal: string;
  /** Working directory — local path for LocalExecutor, remote path for SshExecutor. */
  cwd: string;
  /** Privileged mode, passed explicitly from trusted server config. */
  permissionMode: string;
}

export interface Executor {
  /** Confirm the cwd is usable. Returns an error message, or null when valid. */
  validateCwd(cwd: string): Promise<string | null>;
  /** Spawn the headless agent. Returns a handle with `kill()` + `done`. */
  spawn(req: AgentSpawnRequest): HeadlessRunHandle;
}
