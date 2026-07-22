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
