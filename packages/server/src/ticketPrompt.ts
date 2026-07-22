/**
 * Main-agent prompt assembly for tickets (spec 2026-07-22 §5).
 *
 * Extracted from index.ts so the learned-guide prefix and the mandatory HEADLINE
 * suffix live in one testable place. When `guideText` is empty the output is
 * byte-identical to the original inline prompt — no behaviour change for routes
 * with nothing learned yet.
 */

/** The mandatory trailing instruction that yields the ~30-char card headline. */
export const HEADLINE_INSTRUCTION =
  '\n\n---\n작업을 마친 뒤, 마지막 줄에 반드시 다음 형식으로 결과를 30자 이내 한 줄로 요약하세요 (다른 말 없이):\nHEADLINE: <핵심 결과 한 줄>';

export function buildMainPrompt(goal: string, guideText = ''): string {
  const prefix = guideText.trim() ? `${guideText.trim()}\n\n---\n` : '';
  return `${prefix}${goal}${HEADLINE_INSTRUCTION}`;
}
