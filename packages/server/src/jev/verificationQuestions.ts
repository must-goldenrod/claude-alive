/**
 * The one question the completion gate asks, in Jev's typed form.
 *
 * Shared deliberately by the offline replay (`replay.ts`) and the live fallback
 * (`gateFallback.ts`). The replay's numbers are only evidence about the fallback
 * if both ask the *same* thing — the moment the wordings drift, the measurement
 * stops describing what production does, and nobody notices because both still
 * work.
 */
import type { JevQuestion } from './client.js';
import { noulQuestion, scoreQuestion } from './client.js';

/** Lowest level first; the API returns a weighted mean over these indices. */
export const COVERAGE_LEVELS = [
  'none of the goal is addressed',
  'one part of several is addressed',
  'most of the goal is addressed',
  'every part of the goal is addressed',
] as const;

/** Keep one pathological report from dominating the bill and the context. */
export const MAX_REPORT_CHARS = 12_000;
export const MAX_GOAL_CHARS = 4_000;

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

/**
 * Goal and report travel as separate fields rather than one concatenated
 * string: the question is whether the second satisfies the first, and the API
 * takes structured state, so the boundary between them should not be something
 * the model has to infer from formatting.
 */
export function buildVerificationState(goal: string, report: string): Record<string, unknown> {
  return { goal: clip(goal, MAX_GOAL_CHARS), report: clip(report, MAX_REPORT_CHARS) };
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
