/**
 * Confidence signaling (D-046 §6).
 *
 * The system exposes its own uncertainty so users calibrate trust correctly:
 *   high   — clear rule hits + usage/judge + baseline-consistent
 *   medium — default when signals are mixed
 *   low    — unusual context, extreme baseline drift, or weak signals only
 *
 * LLM judge trigger is rebound to `confidence === 'low'` (see worker/jobs.ts).
 */

export type Confidence = 'high' | 'medium' | 'low';

export const LOW_CONFIDENCE_DELTA = 25;

export interface ConfidenceInput {
  maxSeverity: number; // 0..5, max across rule_hits
  hasUsageScore: boolean;
  hasJudgeScore: boolean;
  /** Cold-start or unusual context — first turn, correction pattern right before, very long session tail. */
  contextUnusual?: boolean;
  /** Baseline delta (final_score - baseline.avg). null when cold-start. */
  baselineDelta?: number | null;
}

export function computeConfidence(input: ConfidenceInput): Confidence {
  if (input.contextUnusual) return 'low';
  if (input.baselineDelta != null && Math.abs(input.baselineDelta) > LOW_CONFIDENCE_DELTA) {
    return 'low';
  }
  if (input.maxSeverity <= 1 && !input.hasUsageScore && !input.hasJudgeScore) {
    return 'low';
  }

  if (input.maxSeverity >= 3 && (input.hasUsageScore || input.hasJudgeScore)) {
    return 'high';
  }
  if (input.maxSeverity === 0 && input.hasUsageScore) {
    return 'high';
  }

  return 'medium';
}
