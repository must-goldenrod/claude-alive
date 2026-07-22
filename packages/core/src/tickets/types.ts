/**
 * Ticket-based autonomous agent dashboard (spec 2026-07-21).
 *
 * A ticket is one goal. The runner spawns a fully-autonomous headless Claude to
 * achieve it, then a second verification agent gates completion. The UI shows
 * only status + a final summary — the intermediate process (grep, SQL, tool
 * calls) is never surfaced.
 */
import type { TicketLocation } from './location.js';

/**
 * Internal lifecycle state (5). The UI collapses `queued`+`running`+`verifying`
 * into a single "in progress" column, so the user sees only 3 states.
 */
export type TicketState = 'queued' | 'running' | 'verifying' | 'done' | 'failed';

/** Why a ticket ended in `failed`. Distinguishes real failure from operational aborts. */
export type TicketFailureReason =
  | 'error' // the main agent crashed / non-zero exit
  | 'verification-failed' // verifier ran and judged the goal unmet
  | 'verification-inconclusive' // the verifier itself failed → fail-closed
  | 'timeout' // exceeded the per-ticket wallclock cap
  | 'cancelled' // user cancelled a running ticket
  | 'interrupted' // server restarted while running/verifying (not reattachable)
  | 'cwd-not-allowed'; // create requested a cwd outside the allowlist

export interface TicketVerification {
  passed: boolean;
  reason: string;
}

/** Token/cost/turn accounting for a ticket's main-agent run, when the model reports it. */
export interface TicketUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Sum of the four token buckets above. */
  totalTokens?: number;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
}

export interface Ticket {
  id: string;
  /** Human-friendly sequential number (#1, #2, …). Assigned at creation. */
  seq: number;
  /** The one-card input: a simple goal statement. */
  goal: string;
  /** Working directory the agent runs in. Local path, or a REMOTE path when `location` is ssh. */
  cwd: string;
  /** Where the agent runs. Absent = local (backward-compatible). */
  location?: TicketLocation;
  state: TicketState;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  /** One-line (~30 char) answer, shown on the card front. Parsed from the agent's HEADLINE. */
  headline?: string;
  /** Full result body (markdown), shown in the detail modal. */
  result?: string;
  /** Model that ran the main agent (e.g. "claude-opus-4-8"), when captured. */
  model?: string;
  /** Whether extended thinking was used, when the runner can determine it. */
  thinking?: boolean;
  /** Reasoning effort level, when available. */
  effort?: string;
  /** Token/cost/turn accounting, when the model reports it. */
  usage?: TicketUsage;
  verification?: TicketVerification;
  failureReason?: TicketFailureReason;
  /** Underlying Claude session id, for optional deep-dive. UI hides it by default. */
  claudeSessionId?: string;
  error?: string;
}

export interface TicketCreateInput {
  goal: string;
  cwd: string;
  location?: TicketLocation;
}

/** States the UI renders as "in progress". */
export const TICKET_ACTIVE_STATES: readonly TicketState[] = ['queued', 'running', 'verifying'];

export function isTicketActive(state: TicketState): boolean {
  return TICKET_ACTIVE_STATES.includes(state);
}
