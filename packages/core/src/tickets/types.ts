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
 * Internal lifecycle state. `queued`+`running`+`verifying` collapse to a single
 * "in progress" column. `decision` means the agent asked the human to choose and
 * is paused awaiting a follow-up reply (it holds no concurrency slot but is
 * resumable — neither active nor terminal).
 */
export type TicketState = 'queued' | 'running' | 'verifying' | 'decision' | 'done' | 'failed';

/** One exchange in a ticket's conversation thread (goal → agent → user reply → …). */
export type TicketTurnRole = 'agent' | 'user';
export type TicketTurnKind = 'result' | 'decision' | 'prompt';
export interface TicketTurn {
  role: TicketTurnRole;
  kind: TicketTurnKind;
  /** Full text: agent result body, the DECISION question, or the user's reply. */
  text: string;
  /** Agent one-line headline for a `result` turn, when present. */
  headline?: string;
  /** Per-run usage for an agent turn (the ticket's top-level `usage` is the sum). */
  usage?: TicketUsage;
  at: number;
}

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
  /** The pending question when `state === 'decision'`, parsed from `DECISION:`. */
  decisionQuestion?: string;
  /** Full conversation thread (goal, agent results/decisions, user replies). */
  turns?: TicketTurn[];
  /** Number of agent runs so far (initial run = 1, each reply adds one). */
  rounds?: number;
}

/** Sum two usage records field-by-field so a ticket's `usage` stays cumulative across runs. */
export function addUsage(a: TicketUsage | undefined, b: TicketUsage | undefined): TicketUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const add = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    cacheReadTokens: add(a.cacheReadTokens, b.cacheReadTokens),
    cacheCreationTokens: add(a.cacheCreationTokens, b.cacheCreationTokens),
    totalTokens: add(a.totalTokens, b.totalTokens),
    costUsd: add(a.costUsd, b.costUsd),
    numTurns: add(a.numTurns, b.numTurns),
    durationMs: add(a.durationMs, b.durationMs),
  };
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
