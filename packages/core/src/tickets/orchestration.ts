/**
 * Orchestration backends (spec 2026-07-22 §3).
 *
 * A ticket's orchestrator agent (Claude) can delegate subtasks to sub-agent
 * backends. This describes the backends the user connects and their live status,
 * shown in the onboarding surface.
 */
export type BackendId = 'claude-local' | 'ssh' | 'litellm';

export type BackendKind = 'orchestrator' | 'subagent' | 'location';

export interface BackendStatus {
  id: BackendId;
  label: string;
  kind: BackendKind;
  /** Whether the last connectivity check succeeded. Undefined = not checked yet. */
  connected?: boolean;
  /** Human detail: error message, model count, etc. */
  detail?: string;
  /** For subagent backends (litellm): available model ids. */
  models?: string[];
}

/**
 * One sub-agent delegation an orchestrator ticket made (via the `ca-delegate`
 * tool). Captured so the ticket can expose WHICH models did WHAT — not just the
 * orchestrator's own model.
 */
export interface TicketDelegation {
  /** Sub-agent model that actually answered, e.g. "gemini/gemini-3.6-flash". */
  model: string;
  /**
   * The model the orchestrator asked for, present only when a fallback took
   * over (the first choice was rate-limited or retired). Makes a substituted
   * answer visible instead of silent.
   */
  requestedModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  /** First chars of the delegated prompt, so the process is legible. */
  promptPreview?: string;
  at: number;
}
