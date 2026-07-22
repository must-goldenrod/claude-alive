/**
 * Deterministic, one-shot guide synthesis (spec 2026-07-22 §4).
 *
 * From a route's evaluations, pick the strongest good exemplars (follow these)
 * and recent bad ones (avoid these), and render a short guide that gets prepended
 * to future tickets' prompts for that route. No model call — "one-shot" here
 * means "inject the single strongest exemplar", not "train".
 */
import type { TicketEvaluation, RouteGuide } from '@claude-alive/core';

const MAX_GOOD = 2;
const MAX_BAD = 2;
const MAX_TEXT = 800;
/** Keep exemplar fragments short so a few fit within the text cap. */
const MAX_FRAGMENT = 160;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function goodLine(e: TicketEvaluation): string {
  const outcome = e.headline ? ` → ${e.headline}` : '';
  return clip(`${e.goal}${outcome}`, MAX_FRAGMENT);
}

function badLine(e: TicketEvaluation): string {
  const why = e.note || e.failureReason || 'unmet';
  return clip(`${e.goal} → ${why}`, MAX_FRAGMENT);
}

/**
 * Synthesise the guide for a route. `evals` should already be filtered to the
 * route. Returns empty `text` when there is nothing labelled to learn from.
 *
 * Only records the human has opted into (`reflected === true`) shape the guide —
 * an unapproved evaluation, however it was labelled, never leaks into a future
 * prompt (spec 2026-07-22, bias-reflection gate).
 */
export function synthesizeGuide(
  route: string,
  evals: readonly TicketEvaluation[],
  now: number,
): RouteGuide {
  const reflected = evals.filter((e) => e.reflected === true);
  const good = reflected
    .filter((e) => e.label === 'good')
    .sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt)
    .slice(0, MAX_GOOD);
  const bad = reflected
    .filter((e) => e.label === 'bad')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_BAD);

  const goodCount = reflected.filter((e) => e.label === 'good').length;
  const badCount = reflected.filter((e) => e.label === 'bad').length;

  let text = '';
  if (good.length > 0 || bad.length > 0) {
    const parts: string[] = ['[이 프로젝트에서 학습된 작업 가이드 / Learned guide for this project]'];
    if (good.length > 0) {
      parts.push('잘된 사례(따를 것) / Do:');
      for (const e of good) parts.push(` - ${goodLine(e)}`);
    }
    if (bad.length > 0) {
      parts.push('피해야 할 사례 / Avoid:');
      for (const e of bad) parts.push(` - ${badLine(e)}`);
    }
    text = parts.join('\n').slice(0, MAX_TEXT);
  }

  return { route, text, goodCount, badCount, updatedAt: now };
}
