/**
 * Recognise an agent run that was stopped by the account, not by the work.
 *
 * When the subscription's usage window is spent (or the API answers 429, or a
 * spend cap trips) the `claude` CLI still exits with an error result, and the
 * runner used to file it under `error` like any crash. That hides the one fact
 * the reader needs — "nothing is wrong with the ticket, wait for the reset" —
 * and seeds a `bad` evaluation label for work that never got to run.
 *
 * The same holds for a model this account cannot use (the Fable presets on a
 * plan without access): it is a configuration problem, not a failed attempt.
 *
 * Patterns come from the CLI's own messages (`usage limit reached`, `You've hit
 * your limit · resets …`, `You're out of extra usage`, `spend limit reached`,
 * `There's an issue with the selected model (…)`) and the API error types.
 */
import type { TicketFailureReason } from '@claude-alive/core';

export type AgentQuotaReason = Extract<TicketFailureReason, 'usage-limit' | 'model-unavailable'>;

const USAGE_LIMIT_RE =
  /usage limit reached|hit your limit|out of extra usage|spend limit reached|usage credit limit|credit balance (?:is )?too low|rate_limit_error|rate limited|api error:? 429|429 too many requests|limit reached[^\n]{0,40}resets?/i;

const MODEL_UNAVAILABLE_RE =
  /issue with the selected model|model[_ ]not[_ ]found|not_found_error[^\n]{0,80}model|(?:do not|don't) have access to (?:this |the )?model|invalid model/i;

/** Longest excerpt of the CLI's own message kept in the summary. */
const DETAIL_LIMIT = 160;

export interface AgentQuotaError {
  reason: AgentQuotaReason;
  /** One-line Korean summary for the ticket card / API. */
  summary: string;
}

/** The first line of `text` matching `re`, collapsed and trimmed. */
function matchingLine(text: string, re: RegExp): string | undefined {
  const line = text.split('\n').find((l) => re.test(l))?.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT - 1)}…` : line;
}

/**
 * Classify the agent's final result text and stderr. Returns undefined for any
 * other failure so the caller keeps its generic exit explanation.
 */
export function classifyAgentQuotaError(texts: ReadonlyArray<string | null | undefined>): AgentQuotaError | undefined {
  const text = texts.filter((t): t is string => typeof t === 'string' && t.length > 0).join('\n');
  if (!text) return undefined;

  const usage = matchingLine(text, USAGE_LIMIT_RE);
  if (usage) {
    return {
      reason: 'usage-limit',
      summary: `사용량 한도에 도달해 에이전트가 중단됨 — 한도가 초기화된 뒤 다시 실행하세요: ${usage}`,
    };
  }
  const model = matchingLine(text, MODEL_UNAVAILABLE_RE);
  if (model) {
    return {
      reason: 'model-unavailable',
      summary: `요청한 모델을 이 계정에서 쓸 수 없어 실행되지 않음 — 다른 실행 프로필을 고르세요: ${model}`,
    };
  }
  return undefined;
}
