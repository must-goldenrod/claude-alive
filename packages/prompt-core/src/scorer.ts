/**
 * Quality score computation per docs/05-quality-engine.md §3 (D-046).
 *
 * D-046 asymmetric + bonus + efficiency + cap model:
 *
 *   rule_score  = max(0, 100 - Σ(severity_weight))                    // §3.2
 *   bonus       = positiveBonus(signals)                              // §3.3  (0..10)
 *   usage_score = 0.25*fail + 0.20*reuse + 0.10*length                // §3.4
 *               + 0.25*feedback + 0.20*efficiency  (renormalized)
 *   raw_final   = compose(rule_score, usage_score, judge_score)       // §3.4
 *   capped      = applyCap(raw_final + bonus, maxSeverity, sev3Count) // §3.5
 *   final_score = round(capped)
 *
 *   tier        = tierFor(final_score)                                // §3.6 (90/70/50)
 *
 * Legacy entry points (computeRuleScore/computeUsageScore/composeFinalScore/tierFor)
 * keep their original signatures so existing callers (worker) don't break.
 */

// ─── Severity weights ───────────────────────────────────────────────────────
// D-046 reshuffled severities. Weights reflect the new severity ceiling +
// bonus + asymmetric cap, so they no longer need to carry all the signal
// themselves (cap takes over at severity ≥ 4).
export const SEVERITY_WEIGHT: Record<number, number> = { 1: 2, 2: 5, 3: 10, 4: 18, 5: 30 };

export interface RuleHitLike {
  severity: number;
}

export function computeRuleScore(hits: RuleHitLike[]): number {
  const penalty = hits.reduce(
    (sum, h) => sum + (SEVERITY_WEIGHT[h.severity as keyof typeof SEVERITY_WEIGHT] ?? 0),
    0
  );
  return Math.max(0, 100 - penalty);
}

// ─── Positive signal bonus (§3.3, D-046) ────────────────────────────────────

export interface PositiveSignals {
  hasOutputFormat?: boolean; // +3
  hasSuccessCriteria?: boolean; // +3
  hasExample?: boolean; // +2 (only counted when wordCount >= 40)
  hasFilePathOrVersion?: boolean; // +2
  wordCount?: number;
}

export const BONUS_WEIGHTS = {
  outputFormat: 3,
  successCriteria: 3,
  example: 2,
  pathOrVersion: 2,
} as const;
export const BONUS_CAP = 10;

export function positiveBonus(s: PositiveSignals): number {
  let b = 0;
  if (s.hasOutputFormat) b += BONUS_WEIGHTS.outputFormat;
  if (s.hasSuccessCriteria) b += BONUS_WEIGHTS.successCriteria;
  if (s.hasExample && (s.wordCount ?? 0) >= 40) b += BONUS_WEIGHTS.example;
  if (s.hasFilePathOrVersion) b += BONUS_WEIGHTS.pathOrVersion;
  return Math.min(BONUS_CAP, b);
}

// ─── Usage score with efficiency axis (§3.4, D-046) ─────────────────────────

export interface UsageMetrics {
  toolCalls: number;
  toolFails: number;
  reuseCount: number;
  responseLength: number;
  expectedResponseRange?: { min: number; max: number };
  feedbackUps?: number;
  feedbackDowns?: number;
  /** D-046: first-shot success (0 | 1). */
  firstShotSuccess?: 0 | 1 | null;
  /** D-046: total tool_use events triggered by this turn. */
  turnToolCallCount?: number | null;
  /** D-046: number of consecutive follow-up turns sharing this intent. */
  followUpDepth?: number | null;
}

function toolEconomyScore(calls: number): number {
  if (calls <= 0) return 100;
  if (calls <= 3) return 90;
  if (calls <= 8) return 75;
  if (calls <= 15) return 50;
  return 25;
}

function followUpScore(depth: number): number {
  if (depth <= 1) return 100;
  if (depth === 2) return 70;
  if (depth === 3) return 40;
  return 20;
}

/**
 * Efficiency component of usage_score (0..100). Returns null if none of the
 * contributing signals are present — lets caller drop it from the weighted
 * average entirely instead of charging a neutral 75.
 */
export function computeEfficiencyScore(m: UsageMetrics): number | null {
  const hasAny =
    m.firstShotSuccess != null || m.turnToolCallCount != null || m.followUpDepth != null;
  if (!hasAny) return null;
  const fs = m.firstShotSuccess ?? 1;
  const tc = m.turnToolCallCount ?? 0;
  const fd = m.followUpDepth ?? 1;
  const raw = fs * 60 + toolEconomyScore(tc) * 0.3 + followUpScore(fd) * 0.1;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function computeUsageScore(m: UsageMetrics): number | null {
  const hasFeedback = (m.feedbackUps ?? 0) + (m.feedbackDowns ?? 0) > 0;
  const hasEfficiency =
    m.firstShotSuccess != null || m.turnToolCallCount != null || m.followUpDepth != null;
  if (
    m.toolCalls === 0 &&
    m.responseLength === 0 &&
    m.reuseCount === 0 &&
    !hasFeedback &&
    !hasEfficiency
  ) {
    return null;
  }

  // D-046 weights (§3.4):
  //   fail 0.25 · reuse 0.20 · length 0.10 · feedback 0.25 · efficiency 0.20
  // Missing components are dropped and weights renormalized so no phantom
  // neutral "75" leaks into the score.
  const parts: Array<{ w: number; s: number }> = [];

  const failRate = m.toolCalls > 0 ? m.toolFails / m.toolCalls : 0;
  parts.push({ w: 0.25, s: (1 - failRate) * 100 });

  const reusePenalty = Math.min(1, m.reuseCount / 5);
  parts.push({ w: 0.2, s: (1 - reusePenalty) * 100 });

  // Length fit: only include when an expected range was provided.
  if (m.expectedResponseRange) {
    const { min, max } = m.expectedResponseRange;
    let lengthScore: number;
    if (m.responseLength >= min && m.responseLength <= max) lengthScore = 100;
    else if (m.responseLength < min)
      lengthScore = Math.max(0, 100 - ((min - m.responseLength) / min) * 100);
    else lengthScore = Math.max(0, 100 - ((m.responseLength - max) / max) * 100);
    parts.push({ w: 0.1, s: lengthScore });
  }

  if (hasFeedback) {
    const ups = m.feedbackUps ?? 0;
    const downs = m.feedbackDowns ?? 0;
    parts.push({ w: 0.25, s: (ups / (ups + downs)) * 100 });
  }

  const eff = computeEfficiencyScore(m);
  if (eff != null) parts.push({ w: 0.2, s: eff });

  const totalWeight = parts.reduce((a, b) => a + b.w, 0);
  if (totalWeight === 0) return null;
  const raw = parts.reduce((a, b) => a + b.w * b.s, 0) / totalWeight;
  return Math.round(raw);
}

// ─── Cap floor (§3.5, D-046) ───────────────────────────────────────────────

export interface CapInput {
  maxSeverity: number;
  severity3Count: number;
}

export function capFor({ maxSeverity, severity3Count }: CapInput): number {
  if (maxSeverity >= 5) return 40;
  if (maxSeverity >= 4) return 60;
  if (severity3Count >= 2) return 75;
  return 100;
}

export function applyCap(score: number, cap: CapInput): { score: number; cap: number } {
  const c = capFor(cap);
  return { score: Math.min(score, c), cap: c };
}

// ─── Tier (§3.6 · D-046 bands 90/70/50) ────────────────────────────────────

export function tierFor(score: number): 'good' | 'ok' | 'weak' | 'bad' {
  if (score >= 90) return 'good';
  if (score >= 70) return 'ok';
  if (score >= 50) return 'weak';
  return 'bad';
}

// ─── Compose final score ───────────────────────────────────────────────────

export interface ScoreComposition {
  rule_score: number;
  usage_score: number | null;
  judge_score: number | null;
  /** D-046: positive signal bonus (0..10). Added after weighted mix, before cap. */
  bonus?: number;
  /** D-046: highest severity hit observed; drives the cap floor. */
  maxSeverity?: number;
  /** D-046: count of severity-3 hits (for the "two mediums cap at 75" rule). */
  severity3Count?: number;
}

export interface ScoreOutcome {
  final_score: number;
  tier: 'good' | 'ok' | 'weak' | 'bad';
  /** D-046: cap that was applied, if any (null when no cap triggered, i.e. cap=100). */
  cap?: number | null;
  /** D-046: bonus actually added. */
  bonus?: number;
}

export function composeFinalScore(s: ScoreComposition): ScoreOutcome {
  let mixed: number;
  if (s.judge_score != null && s.usage_score != null) {
    mixed = 0.5 * s.rule_score + 0.3 * s.usage_score + 0.2 * s.judge_score;
  } else if (s.judge_score != null) {
    mixed = 0.6 * s.rule_score + 0.4 * s.judge_score;
  } else if (s.usage_score != null) {
    mixed = 0.7 * s.rule_score + 0.3 * s.usage_score;
  } else {
    mixed = s.rule_score;
  }

  const bonus = s.bonus ?? 0;
  const withBonus = Math.min(100, mixed + bonus);

  const capInput: CapInput = {
    maxSeverity: s.maxSeverity ?? 0,
    severity3Count: s.severity3Count ?? 0,
  };
  const { score: capped, cap } = applyCap(withBonus, capInput);

  const finalRounded = Math.round(capped);
  return {
    final_score: finalRounded,
    tier: tierFor(finalRounded),
    cap: cap < 100 ? cap : null,
    bonus,
  };
}
