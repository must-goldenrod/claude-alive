/**
 * Offline replay of the completion gate against Jev.
 *
 * Nothing here runs on the live ticket path. It reads the stored evaluation
 * records, asks Jev the same question the gate answers — "did the agent achieve
 * the goal it was given?" — and tabulates Jev, the gate and the human label side
 * by side. That table is what decides whether Jev earns a seat at all, and it
 * costs about two cents to produce, so it comes before any wiring.
 *
 * Why this is worth measuring at all: over the 396 records a human has labelled,
 * the gate's PASS holds up (333 good / 7 bad) but its FAIL does not — 27 of the
 * 28 FAILs a human judged were overturned to `good`. A second opinion with a
 * *calibrated* probability is the only kind that can be thresholded, which is
 * what separating those 27 from the 1 requires.
 *
 * Thresholds are deliberately NOT chosen here. The raw `noul` probability is
 * kept per row and the boundary is swept afterwards, so the cutoff is read off
 * measured data instead of being guessed before the data exists.
 */
import type { JevClient, JevQuestion, JevState } from './client.js';
import { JevError, noulQuestion, scoreQuestion } from './client.js';
import { isUnderRoot } from '../panel/panelPolicy.js';

/** Lowest level first; the API returns a weighted mean over these indices. */
export const COVERAGE_LEVELS = [
  'none of the goal is addressed',
  'one part of several is addressed',
  'most of the goal is addressed',
  'every part of the goal is addressed',
] as const;

/** Keep one pathological report from dominating the bill and the context. */
const MAX_REPORT_CHARS = 12_000;
const MAX_GOAL_CHARS = 4_000;

/** The subset of a stored `TicketEvaluation` this replay needs. */
export interface ReplayRecord {
  ticketId: string;
  /** The ticket's working directory, as `evalStore` records it. */
  route?: string | undefined;
  goal?: string | undefined;
  /** The agent's own report. Absent on runs that never reported. */
  result?: string | undefined;
  /** The gate's verdict; undefined when it could not produce one. */
  verdictPassed?: boolean | undefined;
  label?: 'good' | 'bad' | 'unrated' | undefined;
  humanLabeled?: boolean | undefined;
  failureReason?: string | undefined;
}

/** Gate outcome as this replay classifies it. */
export type GateOutcome = 'pass' | 'fail' | 'inconclusive';

export interface ReplayRow {
  ticketId: string;
  /** P(goal was met), straight from Jev. Thresholds are applied later. */
  noul: number;
  /** Weighted mean over {@link COVERAGE_LEVELS}, 0..3. */
  coverage: number;
  gate: GateOutcome;
  /** The human's label, or null when they never judged this ticket. */
  human: 'good' | 'bad' | null;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

/**
 * Whether a record can be replayed.
 *
 * A record needs a goal and a report — with no report there is no claim to
 * judge. An `inconclusive` record is kept even though it has no verdict: those
 * 12 are precisely the cases a schema-constrained model is supposed to recover.
 * A run that was cancelled, timed out or crashed is excluded: its report, if
 * any, describes work that was interrupted, and grading it would measure the
 * interruption rather than the gate.
 */
export function isReplayable(record: ReplayRecord): boolean {
  if (!record.goal || !record.result) return false;
  if (record.verdictPassed !== undefined) return true;
  return record.failureReason === 'verification-inconclusive';
}

/**
 * The replay obeys the same boundary the live panels do.
 *
 * `panelPolicy` exists because a ticket's goal and report leave the machine when
 * a panel reviews it, and some of them may not. This sends the same two fields
 * to a fifth vendor, so it answers to the same policy — a replay is not a
 * loophole because it runs offline.
 *
 * A record with no route is dropped as soon as ANY root is excluded: without a
 * cwd there is no way to prove it is outside the boundary, and the policy in
 * `panelPolicy.ts` is fail-closed on exactly that question.
 */
export function selectReplayable(
  records: readonly ReplayRecord[],
  excludedRoots: readonly string[],
): ReplayRecord[] {
  return records.filter((record) => {
    if (!isReplayable(record)) return false;
    if (excludedRoots.length === 0) return true;
    if (!record.route) return false;
    return !isUnderRoot(record.route, excludedRoots);
  });
}

/**
 * Whether this record's state was cut to fit the caps.
 *
 * Counted per run rather than assumed away: a clipped report is judged on its
 * first 12,000 characters, and "did it cover the goal" is exactly the question a
 * missing tail can flip. If the count is ever more than a handful, the cap is
 * the finding, not the verdict.
 */
export function wasClipped(record: ReplayRecord): boolean {
  return (record.goal ?? '').length > MAX_GOAL_CHARS || (record.result ?? '').length > MAX_REPORT_CHARS;
}

export function gateOutcomeOf(record: ReplayRecord): GateOutcome {
  if (record.verdictPassed === true) return 'pass';
  if (record.verdictPassed === false) return 'fail';
  return 'inconclusive';
}

/** Only a label the human actually set counts; the auto label is seeded from the gate. */
export function humanLabelOf(record: ReplayRecord): 'good' | 'bad' | null {
  if (!record.humanLabeled) return null;
  return record.label === 'good' || record.label === 'bad' ? record.label : null;
}

/**
 * Goal and report travel as separate fields rather than one concatenated
 * string: the question is whether the second satisfies the first, and the API
 * takes structured state, so the boundary between them should not be something
 * the model has to infer from formatting.
 */
export function buildVerificationState(record: ReplayRecord): Record<string, unknown> {
  return {
    goal: clip(record.goal ?? '', MAX_GOAL_CHARS),
    report: clip(record.result ?? '', MAX_REPORT_CHARS),
  };
}

/**
 * The two questions.
 *
 * `met` is the gate's own question, worded from the gate's measured lesson: the
 * failure mode that survived 96.8% PASS precision was reports that were accurate
 * about the *wrong work*, so the criteria name that case explicitly rather than
 * asking about correctness.
 *
 * `coverage` exists because a goal with several parts is the other measured
 * failure. A rubric separates "solved one of three" from "solved none", which a
 * yes/no collapses.
 */
export function buildVerificationQuestions(): Record<string, JevQuestion> {
  return {
    met: noulQuestion(
      'Did the agent actually achieve the goal it was given, judging only from its own report?',
      'the report covers every part of the goal it was given',
      'the report is coherent but solves a different or smaller problem than the goal, or is too thin to judge',
    ),
    coverage: scoreQuestion('How much of the goal does the report account for?', COVERAGE_LEVELS),
  };
}

export interface ReplayTally {
  threshold: number;
  /** Rows a human labelled — the only ones that can score anything. */
  judged: number;
  truePass: number;
  falsePass: number;
  trueFail: number;
  falseFail: number;
  /** Gate said FAIL, Jev says pass, human says good. */
  gateFalseAlarmsJevAvoided: number;
  /** Gate said PASS, Jev says fail, human says bad. */
  gateMissesJevCaught: number;
  agreementWithHuman: number;
}

/** Confusion counts at one boundary. `noul >= threshold` is a Jev pass. */
export function tallyAt(rows: readonly ReplayRow[], threshold: number): ReplayTally {
  const judged = rows.filter((r) => r.human !== null);
  let truePass = 0;
  let falsePass = 0;
  let trueFail = 0;
  let falseFail = 0;
  let gateFalseAlarmsJevAvoided = 0;
  let gateMissesJevCaught = 0;

  for (const row of judged) {
    const jevPass = row.noul >= threshold;
    const humanGood = row.human === 'good';
    if (jevPass && humanGood) truePass += 1;
    else if (jevPass && !humanGood) falsePass += 1;
    else if (!jevPass && !humanGood) trueFail += 1;
    else falseFail += 1;

    if (row.gate === 'fail' && jevPass && humanGood) gateFalseAlarmsJevAvoided += 1;
    if (row.gate === 'pass' && !jevPass && !humanGood) gateMissesJevCaught += 1;
  }

  const correct = truePass + trueFail;
  return {
    threshold,
    judged: judged.length,
    truePass,
    falsePass,
    trueFail,
    falseFail,
    gateFalseAlarmsJevAvoided,
    gateMissesJevCaught,
    agreementWithHuman: judged.length === 0 ? 0 : correct / judged.length,
  };
}

/** Default sweep: fine near the ends, where a usable cutoff is most likely to sit. */
export const DEFAULT_THRESHOLDS = [0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98] as const;

export function sweepThresholds(
  rows: readonly ReplayRow[],
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): ReplayTally[] {
  return thresholds.map((t) => tallyAt(rows, t));
}

export interface ReplayOneResult {
  row?: ReplayRow;
  /** Why this record produced no row. */
  error?: string;
  inputTokens?: number;
}

/** One record → one Jev call. Errors are returned, never thrown: a replay of 382 must not stop at one. */
export async function replayOne(client: JevClient, record: ReplayRecord): Promise<ReplayOneResult> {
  try {
    const result = await client.decide(
      buildVerificationState(record) as JevState,
      buildVerificationQuestions(),
    );
    const met = result.answers.met;
    const coverage = result.answers.coverage;
    if (met?.type !== 'noul' || coverage?.type !== 'score') {
      return { error: 'unexpected answer types' };
    }
    return {
      row: {
        ticketId: record.ticketId,
        noul: met.noul,
        coverage: coverage.score,
        gate: gateOutcomeOf(record),
        human: humanLabelOf(record),
      },
      ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
    };
  } catch (error) {
    return { error: error instanceof JevError ? error.message : String(error) };
  }
}

export interface ReplayProgress {
  done: number;
  total: number;
}

export interface ReplayAllResult {
  rows: ReplayRow[];
  errors: { ticketId: string; error: string }[];
  inputTokens: number;
  /** How many records had their goal or report cut to fit the caps. */
  clipped: number;
}

/**
 * Replay many records with bounded concurrency.
 *
 * Bounded because the API meters requests and a 382-wide burst is the shape most
 * likely to trip a rate limit and turn a measurement into a partial one.
 */
export async function replayAll(
  client: JevClient,
  records: readonly ReplayRecord[],
  opts: { concurrency?: number; onProgress?: (p: ReplayProgress) => void } = {},
): Promise<ReplayAllResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const rows: ReplayRow[] = [];
  const errors: { ticketId: string; error: string }[] = [];
  let inputTokens = 0;
  let clipped = 0;
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      const record = records[index];
      if (!record) return;
      if (wasClipped(record)) clipped += 1;
      const result = await replayOne(client, record);
      if (result.row) rows.push(result.row);
      if (result.error) errors.push({ ticketId: record.ticketId, error: result.error });
      inputTokens += result.inputTokens ?? 0;
      done += 1;
      opts.onProgress?.({ done, total: records.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, worker));
  rows.sort((a, b) => a.ticketId.localeCompare(b.ticketId));
  return { rows, errors, inputTokens, clipped };
}
