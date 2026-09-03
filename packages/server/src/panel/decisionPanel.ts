/**
 * Multi-model resolution of a ticket's pending decision.
 *
 * When an agent emits `DECISION:` the ticket parks and waits for a human. Most
 * of those questions are not actually judgement calls that need the human — they
 * are questions the agent could not answer from inside its own run, and a
 * reviewer with the same context but no sunk cost answers them fine.
 *
 * So before the human is bothered, the question goes to several models that share
 * none of the worker's context. If they independently land on the same answer,
 * that answer is fed straight back to the agent and the ticket resumes. If they
 * disagree — which is exactly the signal that the question was a real judgement
 * call — the ticket stays parked and the human decides. The panel is allowed to
 * be unsure; it is not allowed to guess.
 */
import type {
  DecisionOpinion,
  PanelConsensus,
  Ticket,
  TicketDecisionPanel,
} from '@claude-alive/core';
import { extractJsonObject, readString, type Panel, type PanelMemberResult } from './litellmPanel.js';

export const DECISION_SYSTEM = [
  'You are one of several independent advisors resolving a decision an autonomous',
  'coding agent could not make on its own. You do not share the agent\'s context and',
  'you cannot inspect the repository — answer from the goal, the work so far, and the',
  'question itself.',
  '',
  'Pick the option you believe is correct and state it in a form the agent can act on',
  'directly. If the question offers labelled options (A/B/C or 1/2/3), set "choice" to',
  'that label. If you genuinely cannot tell which option is right from what you were',
  'given, say so with a low confidence rather than guessing — an unsure answer that is',
  'flagged is useful, a confident wrong answer is not.',
  '',
  'Answer with ONE JSON object and nothing else:',
  '{"choice": "<option label, or empty>", "recommendation": "<the answer, one actionable line>",',
  ' "rationale": "<why, 1-2 sentences>", "confidence": <0.0-1.0>}',
].join('\n');

const MAX_CONTEXT_CHARS = 8_000;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

export function buildDecisionPrompt(goal: string, workSoFar: string | null, question: string): string {
  return [
    `ORIGINAL GOAL:\n${goal}`,
    '',
    `WORK SO FAR (agent's own report):\n${workSoFar ? clip(workSoFar, MAX_CONTEXT_CHARS) : '(none)'}`,
    '',
    `QUESTION THE AGENT IS BLOCKED ON:\n${question}`,
    '',
    'What should the agent do?',
  ].join('\n');
}

export function toDecisionOpinion(member: PanelMemberResult): DecisionOpinion {
  const base = {
    model: member.model,
    ...(member.respondedModel ? { respondedModel: member.respondedModel } : {}),
  };
  if (member.content === null) {
    return { ...base, recommendation: '', rationale: '', error: member.error ?? 'no answer' };
  }
  const obj = extractJsonObject(member.content);
  const recommendation = obj ? readString(obj, 'recommendation') : null;
  if (!recommendation) {
    return { ...base, recommendation: '', rationale: '', error: 'no parseable recommendation' };
  }
  const confidence = obj && typeof obj.confidence === 'number' ? obj.confidence : undefined;
  return {
    ...base,
    ...(obj && readString(obj, 'choice') ? { choice: readString(obj, 'choice')!.toUpperCase() } : {}),
    recommendation,
    rationale: (obj && readString(obj, 'rationale')) ?? '',
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/**
 * The key two opinions must share to count as agreeing.
 *
 * A labelled option is the reliable key — "A" is "A" whatever prose surrounds
 * it. Without one, fall back to the recommendation text normalized hard (case,
 * punctuation and spacing removed), which agrees only on near-identical answers.
 * That is deliberately strict: a false agreement auto-applies a wrong answer,
 * while a missed agreement merely asks the human, which is where the ticket was
 * already headed.
 */
export function consensusKey(o: DecisionOpinion): string {
  if (o.choice) return `choice:${o.choice}`;
  return `text:${o.recommendation.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '')}`;
}

/** Below this, a winning group is treated as a guess and escalated to the human. */
export const MIN_DECISION_CONFIDENCE = 0.5;

export interface DecisionOutcome {
  stage: 'decided' | 'failed';
  resolution?: string;
  consensus: PanelConsensus;
  reason?: string;
}

/**
 * Decide whether the panel converged.
 *
 * Requires a group that is both at least 2 opinions and a strict majority of the
 * ones that answered. Two of three qualifies; one of two does not, and neither
 * does a 1-1 split.
 */
export function resolveConsensus(opinions: readonly DecisionOpinion[]): DecisionOutcome {
  const voters = opinions.filter((o) => !o.error && o.recommendation);
  const total = voters.length;
  if (total === 0) {
    return { stage: 'failed', consensus: { agree: 0, total: 0 }, reason: 'no advisor produced an answer' };
  }

  const groups = new Map<string, DecisionOpinion[]>();
  for (const o of voters) {
    const key = consensusKey(o);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const winner = [...groups.values()].sort((a, b) => b.length - a.length)[0]!;
  const agree = winner.length;
  const consensus: PanelConsensus = { agree, total };

  if (agree < 2 || agree * 2 <= total) {
    return { stage: 'failed', consensus, reason: 'advisors did not converge on one answer' };
  }

  const scored = winner.filter((o) => o.confidence !== undefined);
  if (scored.length > 0) {
    const mean = scored.reduce((s, o) => s + (o.confidence ?? 0), 0) / scored.length;
    if (mean < MIN_DECISION_CONFIDENCE) {
      return { stage: 'failed', consensus, reason: `advisors agreed but with low confidence (${mean.toFixed(2)})` };
    }
  }

  // The fullest phrasing of the shared answer is the one handed to the agent.
  const resolution = winner.reduce((a, b) => (b.recommendation.length > a.recommendation.length ? b : a)).recommendation;
  return { stage: 'decided', resolution, consensus };
}

export interface DecisionPanelDeps {
  panel: Panel;
  now?: () => number;
}

/**
 * Poll the panel for one ticket's decision. Never throws — a gateway outage
 * yields a `failed` panel, which is the same path as "advisors disagreed": the
 * human takes over.
 */
export async function adviseDecision(
  deps: DecisionPanelDeps,
  ticket: Pick<Ticket, 'goal' | 'result'>,
  question: string,
): Promise<TicketDecisionPanel> {
  const at = (deps.now ?? Date.now)();
  try {
    const members = await deps.panel.run({
      system: DECISION_SYSTEM,
      user: buildDecisionPrompt(ticket.goal, ticket.result ?? null, question),
    });
    const opinions = members.map(toDecisionOpinion);
    const outcome = resolveConsensus(opinions);
    return {
      stage: outcome.stage,
      question,
      opinions,
      ...(outcome.resolution ? { resolution: outcome.resolution } : {}),
      consensus: outcome.consensus,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      at,
    };
  } catch (e) {
    return {
      stage: 'failed',
      question,
      opinions: [],
      consensus: { agree: 0, total: 0 },
      reason: e instanceof Error ? e.message : 'decision panel failed',
      at,
    };
  }
}
