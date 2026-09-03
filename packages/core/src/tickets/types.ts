/**
 * Ticket-based autonomous agent dashboard (spec 2026-07-21).
 *
 * A ticket is one goal. The runner spawns a fully-autonomous headless Claude to
 * achieve it, then a second verification agent gates completion. The UI shows
 * only status + a final summary — the intermediate process (grep, SQL, tool
 * calls) is never surfaced.
 */
import type { TicketLocation } from './location.js';
import type { TicketDelegation } from './orchestration.js';
import type { TicketEffort, TicketRunPreset } from './runProfile.js';

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
  /**
   * Who produced a `user` turn: the human, or the advisory panel answering on
   * their behalf. Absent = human (every turn written before the panel existed).
   */
  by?: 'human' | 'panel';
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

/**
 * One independent reviewer's opinion in the LiteLLM verification panel.
 * `passed === null` means the model never produced a parseable verdict (timeout,
 * rate limit, malformed answer) — it abstains rather than voting either way.
 */
export interface VerificationOpinion {
  /** Model the panel asked for (gateway id or alias). */
  model: string;
  /** Model that actually answered, when a fallback substituted. */
  respondedModel?: string;
  passed: boolean | null;
  reason: string;
  /** Why this reviewer abstained, when `passed` is null. */
  error?: string;
}

/** How many voters agreed with the final verdict, out of how many voted. */
export interface PanelConsensus {
  agree: number;
  total: number;
}

/**
 * The completion gate's report.
 *
 * `passed`/`reason` stay the top-level summary every existing consumer reads.
 * `gate` is the Claude reviewer that inspected the working directory (build,
 * tests, git diff); `panel` holds the independent LiteLLM reviewers that judged
 * the same claim from the report text alone. The Claude gate holds a veto — it
 * is the only reviewer with filesystem access — and a majority of the panel can
 * veto a gate PASS, so a green verdict means both agreed.
 */
export interface TicketVerification {
  passed: boolean;
  reason: string;
  gate?: { passed: boolean; reason: string };
  panel?: VerificationOpinion[];
  consensus?: PanelConsensus;
  at?: number;
}

/** Result of the post-verification auto-commit. Recorded even when it did nothing. */
export interface TicketCommit {
  committed: boolean;
  /** Short sha, present when a commit was actually created. */
  sha?: string;
  /** The commit subject line (bilingual), present whenever a commit was attempted. */
  message?: string;
  /** Number of files in the commit. */
  files?: number;
  /** Why nothing was committed (clean tree, not a repo, remote ticket, git error). */
  skipped?: string;
  at: number;
}

/**
 * Lifecycle of a decision the agent handed back to a human.
 *
 * `pending` — parked, no panel consulted yet. `deciding` — LiteLLM reviewers are
 * being polled. `decided` — they converged and the answer was fed back to the
 * agent automatically. `failed` — no convergence (or no panel available), so the
 * ticket waits for the human.
 */
export type DecisionStage = 'pending' | 'deciding' | 'decided' | 'failed';

/** One reviewer's answer to a decision question. */
export interface DecisionOpinion {
  model: string;
  respondedModel?: string;
  /** Normalized option label (e.g. "A", "2") when the question offered a list. */
  choice?: string;
  /** The reviewer's answer as one line, used verbatim as the reply when adopted. */
  recommendation: string;
  rationale: string;
  /** Self-reported 0–1 confidence, when the reviewer gave one. */
  confidence?: number;
  error?: string;
}

export interface TicketDecisionPanel {
  stage: DecisionStage;
  /** The question the panel was asked (snapshotted; the ticket's may be cleared). */
  question: string;
  opinions: DecisionOpinion[];
  /** The adopted answer, present when `stage === 'decided'`. */
  resolution?: string;
  consensus?: PanelConsensus;
  /** Why the panel could not decide — shown to the human who takes over. */
  reason?: string;
  at: number;
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
  /** When true, the agent runs as an orchestrator that may delegate to sub-agents. */
  orchestrated?: boolean;
  /** Sub-agent delegations this orchestrator made (which models did what). */
  delegations?: TicketDelegation[];
  state: TicketState;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  /** One-line (~30 char) answer, shown on the card front. Parsed from the agent's HEADLINE. */
  headline?: string;
  /** Full result body (markdown), shown in the detail modal. */
  result?: string;
  /**
   * Exact model version that actually served the run (e.g. "claude-opus-4-8"),
   * read back from the result stream. May differ from `requestedModel` — that one
   * is a moving alias, and a fallback can substitute a different model entirely.
   */
  model?: string;
  /** Whether extended thinking was used, when the runner can determine it. */
  thinking?: boolean;
  /**
   * Effort the run was launched with. Snapshotted from the preset at creation, so
   * it stays accurate even if the preset table is redefined later.
   */
  effort?: TicketEffort;
  /** Run preset the human selected (fast/standard/deep). Absent = pre-feature ticket. */
  preset?: TicketRunPreset;
  /** Model alias requested at launch (e.g. "opus"), before the CLI resolved a version. */
  requestedModel?: string;
  /**
   * Flags the executor could not pass because the target `claude` build does not
   * support them. Recorded so a ticket never silently claims an effort it never ran
   * with — an old remote CLI degrades to the default instead of failing the run.
   */
  unsupportedFlags?: string[];
  /** Token/cost/turn accounting, when the model reports it. */
  usage?: TicketUsage;
  verification?: TicketVerification;
  /**
   * Commit created after the gate passed. Absent = auto-commit never ran (the
   * ticket did not reach a passing verdict, or `autoCommit` is off).
   */
  commit?: TicketCommit;
  /**
   * Opt out of the post-verification auto-commit for this ticket.
   * Undefined = enabled, which is the default.
   */
  autoCommit?: boolean;
  /**
   * Opt out of the external review panels (verification second opinion and
   * decision advisory) for this ticket. Both panels send the goal and the
   * agent's report to third-party model providers, so a ticket over sensitive
   * code turns them off and falls back to the local Claude gate alone.
   * Undefined = enabled.
   */
  panelReview?: boolean;
  failureReason?: TicketFailureReason;
  /** Underlying Claude session id, for optional deep-dive. UI hides it by default. */
  claudeSessionId?: string;
  error?: string;
  /** The pending question when `state === 'decision'`, parsed from `DECISION:`. */
  decisionQuestion?: string;
  /**
   * Multi-model review of the pending decision. Its `stage` is the decision's
   * user-facing sub-status (전/중/완료/실패) — `state` stays `decision` throughout,
   * so the queue semantics (holds no slot, resumable) are unchanged.
   */
  decisionPanel?: TicketDecisionPanel;
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
  orchestrated?: boolean;
  /** Run preset. Omitted = the CLI's own defaults (matches pre-feature behaviour). */
  preset?: TicketRunPreset;
  /** Opt out of the post-verification auto-commit. Omitted = enabled. */
  autoCommit?: boolean;
  /** Opt out of the external review panels (nothing leaves the machine). Omitted = enabled. */
  panelReview?: boolean;
}

/** States the UI renders as "in progress". */
export const TICKET_ACTIVE_STATES: readonly TicketState[] = ['queued', 'running', 'verifying'];

export function isTicketActive(state: TicketState): boolean {
  return TICKET_ACTIVE_STATES.includes(state);
}
