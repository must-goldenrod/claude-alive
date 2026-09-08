/**
 * Self-check on the completion gate.
 *
 * The gate is invisible while it works and its failures look exactly like the
 * agent's: a ticket says `failed` either way. That is how 14 tickets (5.3% of
 * everything verified) came to be marked failed by a reviewer that had simply
 * broken, all recording the same unhelpful sentence, without anyone noticing for
 * seven weeks. A number nobody prints is a number nobody watches, so this is
 * computed from the evaluation records and printed once at startup.
 *
 * Precision is measured only against records a human actually labelled — the
 * auto-label is seeded from the verdict itself and would grade the gate on its
 * own homework.
 */
import type { TicketEvaluation } from '@claude-alive/core';

export interface VerificationHealth {
  /** Tickets that reached the gate at all. */
  verified: number;
  /** …of those, how many the gate could not produce a verdict for. */
  inconclusive: number;
  /** PASS verdicts a human confirmed, over PASS verdicts a human judged. */
  passPrecision: { good: number; judged: number } | null;
  /** FAIL verdicts a human confirmed, over FAIL verdicts a human judged. */
  failPrecision: { bad: number; judged: number } | null;
}

const JUDGED = (e: TicketEvaluation): boolean => e.humanLabeled && (e.label === 'good' || e.label === 'bad');

export function verificationHealth(evals: readonly TicketEvaluation[]): VerificationHealth {
  const reachedGate = evals.filter(
    (e) => e.verdictPassed !== undefined || e.failureReason === 'verification-inconclusive',
  );
  const inconclusive = reachedGate.filter((e) => e.failureReason === 'verification-inconclusive').length;

  const passes = evals.filter((e) => e.verdictPassed === true && JUDGED(e));
  const fails = evals.filter((e) => e.failureReason === 'verification-failed' && JUDGED(e));

  return {
    verified: reachedGate.length,
    inconclusive,
    passPrecision: passes.length > 0 ? { good: passes.filter((e) => e.label === 'good').length, judged: passes.length } : null,
    failPrecision: fails.length > 0 ? { bad: fails.filter((e) => e.label === 'bad').length, judged: fails.length } : null,
  };
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

/** One line, or null when nothing has been verified yet. */
export function formatVerificationHealth(h: VerificationHealth): string | null {
  if (h.verified === 0) return null;
  const parts = [`verified ${h.verified}`, `inconclusive ${h.inconclusive} (${pct(h.inconclusive, h.verified)})`];
  if (h.passPrecision) parts.push(`PASS confirmed ${h.passPrecision.good}/${h.passPrecision.judged}`);
  if (h.failPrecision) parts.push(`FAIL confirmed ${h.failPrecision.bad}/${h.failPrecision.judged}`);
  return `[verify] gate health — ${parts.join(' · ')}`;
}
