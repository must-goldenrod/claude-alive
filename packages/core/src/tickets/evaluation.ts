/**
 * Evaluation feedback loop (spec 2026-07-22).
 *
 * Each finished ticket produces a TicketEvaluation. A human labels it good/bad
 * (seeded from the verifier's verdict), and those labels are synthesised per
 * project ("route") into a short guide that is prepended to future tickets'
 * prompts — a one-shot, deterministic quality-improvement loop.
 */
import type { Ticket, TicketFailureReason } from './types.js';
import type { TicketEffort, TicketRunPreset } from './runProfile.js';

export type EvalLabel = 'good' | 'bad' | 'unrated';

export interface TicketEvaluation {
  ticketId: string;
  /** Mirror of the ticket's sequential number, for display. */
  seq: number;
  /** Grouping key for guidance = the ticket's cwd (project root). */
  route: string;
  goal: string;
  /** Join key into the canonical session event log, when captured. */
  claudeSessionId?: string;
  /** Exact model version that served the run. */
  model?: string;
  /** Run profile the ticket was launched with — lets the dataset compare presets. */
  preset?: TicketRunPreset;
  effort?: TicketEffort;
  headline?: string;
  /** From the ticket's verification verdict, when it ran. */
  verdictPassed?: boolean;
  failureReason?: TicketFailureReason;
  /** Provisional label seeded from the verdict. Never overwrites a human label. */
  autoLabel: EvalLabel;
  /** The effective label. Defaults to autoLabel until a human overrides it. */
  label: EvalLabel;
  /** True once a human has set the label; auto re-seeding then leaves it alone. */
  humanLabeled: boolean;
  /** 1..5 influence weight on guide synthesis. Default 3. */
  weight: number;
  note?: string;
  /**
   * Bias-reflection gate (opt-in). Only records with `reflected === true` are
   * synthesised into the route's RouteGuide and injected into future prompts.
   * Defaults to false so a finished ticket never shapes future runs until a
   * human explicitly approves it. Preserved across re-upserts, like humanLabeled.
   */
  reflected: boolean;
  /** Full result body (markdown) snapshot, so dissection survives ticket eviction. */
  result?: string;
  /** When the underlying ticket settled (done/failed). */
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** A per-route guide synthesised from that route's evaluations. */
export interface RouteGuide {
  route: string;
  /** Prompt-injection text. Empty string means "nothing learned yet" — no injection. */
  text: string;
  goodCount: number;
  badCount: number;
  updatedAt: number;
}

export const DEFAULT_EVAL_WEIGHT = 3;
export const MIN_EVAL_WEIGHT = 1;
export const MAX_EVAL_WEIGHT = 5;

/**
 * Failures that say nothing reliable about the work, so no label is seeded.
 *
 * Two different reasons land here.
 *
 * Operational: a ticket the operator cancelled, one the server killed by
 * restarting, one whose cwd was refused, one whose reviewer itself broke. There
 * is no work to judge, and in the audited dataset these were the bulk of every
 * `bad` no human had ever seen.
 *
 * And `verification-failed`, which is not operational but is not evidence
 * either. The gate's two verdicts are not equally reliable: of 221 human-labelled
 * PASSes, 212 were confirmed good (96.8%), but of the 8 human-labelled FAILs, 6
 * were overturned to good and only 1 confirmed bad. Seeding `bad` from a verdict
 * that a human reverses three times in four records a judgement the evidence does
 * not support. The gate still fails the ticket — it just no longer labels it.
 */
const NOT_A_VERDICT_ON_THE_WORK: ReadonlySet<TicketFailureReason> = new Set([
  'cancelled',
  'interrupted',
  'cwd-not-allowed',
  'verification-inconclusive',
  'verification-failed',
]);

/**
 * Provisional label from a finished ticket's outcome:
 * - done + verification passed → good
 * - failed because the agent itself did not deliver (error, timeout) → bad
 * - failed for a reason that is not a judgement of the work → unrated
 * - anything else (done without a passing verdict, still active) → unrated
 */
export function seedAutoLabel(ticket: Pick<Ticket, 'state' | 'verification' | 'failureReason'>): EvalLabel {
  if (ticket.state === 'done' && ticket.verification?.passed === true) return 'good';
  if (ticket.state !== 'failed') return 'unrated';
  // An unrecorded reason predates the distinction; treat it as a real failure.
  return ticket.failureReason && NOT_A_VERDICT_ON_THE_WORK.has(ticket.failureReason) ? 'unrated' : 'bad';
}

/** Clamp an arbitrary weight input into the valid 1..5 integer range. */
export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return DEFAULT_EVAL_WEIGHT;
  return Math.max(MIN_EVAL_WEIGHT, Math.min(MAX_EVAL_WEIGHT, Math.round(weight)));
}
