/**
 * Last seat on the completion gate, for the case where the gate said nothing.
 *
 * The gate is a separate `claude` process asked to end its answer with a JSON
 * verdict. When it does not — measured at 12 of 394 verified tickets (3.0%),
 * every one of them with a complete agent report — the ticket is failed
 * `verification-inconclusive`. That is a formatting failure being recorded as a
 * judgement about the work, and of the 4 such tickets a human later labelled,
 * all 4 were good.
 *
 * Jev cannot fail that way: the answer's shape is fixed by the request, so there
 * is no parse to miss. That, and only that, is why it sits here.
 *
 * What it is NOT: a quality judgement. Replayed over 394 records its probability
 * did not separate human-good from human-bad (AUC 0.495), so it earns no seat
 * where the gate already produced a verdict, and every verdict it does produce
 * is flagged for a human. The threshold below is the probability's own midpoint,
 * not a tuned value — tuning a boundary that measured no signal would dress an
 * arbitrary choice as evidence.
 */
import type { TicketVerification } from '@claude-alive/core';
import type { JevClient } from './client.js';
import { buildVerificationQuestions, buildVerificationState } from './verificationQuestions.js';

/** `noul` at or above this is a pass. The midpoint of a probability, nothing more. */
export const JEV_PASS_THRESHOLD = 0.5;

/** Ceiling for the fallback call. The gate has already spent its own budget twice. */
const JEV_TIMEOUT_MS = 15_000;

/**
 * A verdict from Jev, or null when it could not produce one.
 *
 * Null rather than throwing, so the caller keeps the fail-closed behaviour it
 * had before this existed: a Jev that is rate-limited, slow or misconfigured
 * must leave the gate exactly as inconclusive as it already was.
 */
export async function verdictFromJev(
  jev: JevClient,
  goal: string,
  report: string | null,
  now: () => number = Date.now,
): Promise<TicketVerification | null> {
  let answers;
  try {
    const result = await jev.decide(
      buildVerificationState(goal, report ?? ''),
      buildVerificationQuestions(),
      { timeoutMs: JEV_TIMEOUT_MS },
    );
    answers = result.answers;
  } catch {
    return null;
  }

  const met = answers.met;
  const coverage = answers.coverage;
  if (met?.type !== 'noul') return null;

  const passed = met.noul >= JEV_PASS_THRESHOLD;
  const coverageNote = coverage?.type === 'score' ? `, 커버리지 ${coverage.score.toFixed(2)}/3` : '';

  return {
    passed,
    // Written here rather than by a model: the numbers and their provenance are
    // the whole content, and a reader has to be able to tell this verdict apart
    // from one that actually inspected the working directory.
    reason:
      `완료 게이트가 판정을 내지 못해 Jev(${jev.model})가 대신 판정했습니다. ` +
      `목표 달성 확률 ${met.noul.toFixed(2)}${coverageNote} → ${passed ? '통과' : '실패'}. ` +
      `작업 디렉터리를 보지 않고 리포트만으로 내린 판정이므로 사람이 확인해야 합니다.`,
    // Never claims to be the Claude gate: `gate` stays absent, and the flag says
    // out loud that nobody inspected the working directory.
    flagged: true,
    at: now(),
  };
}
