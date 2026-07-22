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

/**
 * Orchestrator prompt (spec §5). Claude leads the work but may delegate subtasks
 * to a faster/cheaper sub-agent by running the `ca-delegate` tool, then decides
 * with the same HEADLINE/DECISION contract. `delegateCmd` is the absolute path
 * to the delegation CLI (embedded so the agent can call it directly).
 */
export function buildOrchestratorPrompt(goal: string, guideText: string, delegateCmd: string): string {
  const prefix = guideText.trim() ? `${guideText.trim()}\n\n---\n` : '';
  const orchestration =
    '너는 오케스트레이터다. 목표를 직접 수행하되, 무겁거나 병렬화 가능하거나 다른 관점이 필요한 ' +
    '하위 작업은 서브에이전트에 위임할 수 있다. 위임 방법(Bash로 실행):\n' +
    `  ${delegateCmd} --model gemini/gemini-2.5-flash-lite "<하위 작업 프롬프트>"\n` +
    '서브에이전트의 답변이 stdout으로 반환된다. 여러 번/여러 모델로 위임하고 결과를 종합해 판단하라. ' +
    '위임이 불필요하면 직접 처리해도 된다.\n\n---\n';
  return `${prefix}${orchestration}목표: ${goal}${HEADLINE_INSTRUCTION}`;
}
