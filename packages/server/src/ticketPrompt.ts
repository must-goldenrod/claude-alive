/**
 * Main-agent prompt assembly for tickets (spec 2026-07-22 §5).
 *
 * Extracted from index.ts so the learned-guide prefix and the mandatory HEADLINE
 * suffix live in one testable place. When `guideText` is empty the output is
 * byte-identical to the original inline prompt — no behaviour change for routes
 * with nothing learned yet.
 */

/**
 * The mandatory trailing instruction. The agent ends with exactly one of two
 * markers: HEADLINE when the goal is done, or DECISION when it needs a human
 * choice to continue (parsed by extractHeadline / extractDecision).
 */
export const HEADLINE_INSTRUCTION =
  '\n\n---\n작업을 마친 뒤, 마지막 줄에 반드시 아래 중 하나만 출력하세요 (다른 말 없이):\n' +
  '- 목표를 끝냈으면:  HEADLINE: <핵심 결과 30자 이내 한 줄>\n' +
  '- 사람의 결정·선택이 있어야 더 진행할 수 있으면:  DECISION: <무엇을 정해야 하는지와 선택지를 한 줄로>';

export function buildMainPrompt(goal: string, guideText = ''): string {
  const prefix = guideText.trim() ? `${guideText.trim()}\n\n---\n` : '';
  return `${prefix}${goal}${HEADLINE_INSTRUCTION}`;
}
