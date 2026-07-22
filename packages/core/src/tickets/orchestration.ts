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
  /** Sub-agent model id, e.g. "gemini/gemini-2.5-flash-lite". */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  /** First chars of the delegated prompt, so the process is legible. */
  promptPreview?: string;
  at: number;
}
