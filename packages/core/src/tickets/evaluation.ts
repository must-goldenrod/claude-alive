/**
 * Evaluation feedback loop (spec 2026-07-22).
 *
 * Each finished ticket produces a TicketEvaluation. A human labels it good/bad
 * (seeded from the verifier's verdict), and those labels are synthesised per
 * project ("route") into a short guide that is prepended to future tickets'
 * prompts — a one-shot, deterministic quality-improvement loop.
 */
import type { Ticket, TicketFailureReason } from './types.js';

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
  model?: string;
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
 * Provisional label from a finished ticket's outcome:
 * - done + verification passed → good
 * - failed → bad
 * - anything else (done without a passing verdict, still active) → unrated
 */
export function seedAutoLabel(ticket: Pick<Ticket, 'state' | 'verification'>): EvalLabel {
  if (ticket.state === 'done' && ticket.verification?.passed === true) return 'good';
  if (ticket.state === 'failed') return 'bad';
  return 'unrated';
}

/** Clamp an arbitrary weight input into the valid 1..5 integer range. */
export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return DEFAULT_EVAL_WEIGHT;
  return Math.max(MIN_EVAL_WEIGHT, Math.min(MAX_EVAL_WEIGHT, Math.round(weight)));
}
