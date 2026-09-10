/**
 * LiteLLM half of the completion gate.
 *
 * The Claude gate (`ticketVerifier.ts`) inspects the working directory — it can
 * run the build, read the diff, and is therefore authoritative about facts. What
 * it cannot do is disagree with itself: it is the same model family that just
 * produced the work, so a plausible-sounding wrong report is exactly the thing
 * it is least likely to catch.
 *
 * This panel is the second half. Three models from three vendors judge the same
 * claim from the goal and the report alone, with no filesystem access. They
 * cannot confirm a fact the gate missed, but they can refuse a report that does
 * not actually answer the goal — which is the failure mode the gate shares with
 * the worker.
 *
 * The gate's verdict is deliberately withheld from them. It used to be in the
 * prompt, and measured against records a human had overruled the panel then
 * produced more false alarms on good work (2/21) than catches on bad (1/21);
 * with the verdict removed the same models on the same records went to 0/21 and
 * 2/21. An independent reviewer told the first reviewer passed is not
 * independent, and the panel exists only for its independence.
 */
import type { Ticket, TicketVerification, VerificationOpinion, PanelConsensus } from '@claude-alive/core';
import { extractJsonObject, readString, type Panel, type PanelMemberResult } from './litellmPanel.js';
import { VERDICT_LANGUAGE_RULE } from '../verdictLanguage.js';

/**
 * Reviewed verbatim as measured. Two things in here are load-bearing and were
 * each isolated against the records a human had overruled:
 *
 *  - No other reviewer's verdict appears. With the gate's PASS in the prompt the
 *    panel raised more false alarms on good work (2/21) than catches on bad
 *    (1/21); removing it moved that to 0/21 and 2/21.
 *  - The "gap" field is asked for BEFORE the vote and has no escape clause. An
 *    earlier version added "a real gap that does not change the outcome still
 *    passes" and every reviewer took that exit — 0/21 either way. Without it the
 *    same models cast 7/21 against bad work and 2/21 against good, and produced
 *    the only panel vetoes any arm produced (2 of 7, none on good work).
 *
 * Do not edit this text without re-running that comparison; the wording is the
 * experiment result, not a draft.
 */
export const VERIFICATION_SYSTEM = [
  'You are an independent verification reviewer on a panel of several models.',
  'You are judging whether an autonomous agent ACTUALLY achieved the goal it was given.',
  'You have NO filesystem access: judge only from the goal and the agent\'s own report.',
  '',
  'First name the single weakest point in the report in "gap": the claim it supports least,',
  'the part of the goal it covers most thinly, or the check a reader cannot reproduce from',
  'what is written. Every report has one.',
  '',
  'Then decide, strictly. A report that is coherent but solves a different or smaller problem',
  'than the goal FAILS. A goal with several parts FAILS unless the report covers all of them.',
  'A report too thin to judge FAILS. Do not invent facts you cannot see.',
  '',
  'Answer with ONE JSON object and nothing else:',
  '{"gap": "<the weakest point, one sentence>", "passed": true|false, "reason": "<one sentence>"}',
  '',
  // Language only. The judging text above is the measured wording and is not
  // touched; this line constrains how the answer is written, never what it says.
  VERDICT_LANGUAGE_RULE,
].join('\n');

/** Cap on the report text sent to reviewers; a huge body starves the question. */
const MAX_REPORT_CHARS = 12_000;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

export function buildVerificationPanelPrompt(goal: string, report: string | null): string {
  return [
    `GOAL:\n${goal}`,
    '',
    `AGENT REPORT:\n${report ? clip(report, MAX_REPORT_CHARS) : '(none)'}`,
    '',
    'Did the agent achieve the goal?',
  ].join('\n');
}

/** Turn one raw panel answer into a vote. An unparseable answer abstains. */
export function toOpinion(member: PanelMemberResult): VerificationOpinion {
  if (member.content === null) {
    return { model: member.model, passed: null, reason: '', error: member.error ?? '응답 없음' };
  }
  const obj = extractJsonObject(member.content);
  const passed = obj && typeof obj.passed === 'boolean' ? obj.passed : null;
  if (passed === null) {
    return {
      model: member.model,
      ...(member.respondedModel ? { respondedModel: member.respondedModel } : {}),
      passed: null,
      reason: '',
      error: '판정을 읽을 수 없음',
    };
  }
  const gap = obj ? readString(obj, 'gap') : null;
  return {
    model: member.model,
    ...(member.respondedModel ? { respondedModel: member.respondedModel } : {}),
    passed,
    reason: (obj && readString(obj, 'reason')) ?? '',
    ...(gap ? { gap } : {}),
  };
}

/**
 * Combine the Claude gate with the panel into one verdict.
 *
 * Rules, in order:
 *  1. The gate holds a veto. It is the only reviewer that saw the repository, so
 *     a gate FAIL is final and the panel is not even consulted.
 *  2. A MAJORITY of voting panel members can veto a gate PASS. One dissenter is
 *     recorded but does not block — models disagree for bad reasons often enough
 *     that a single NO would make the gate unusable.
 *  3. An empty panel (no key, everyone abstained) degrades to the gate alone.
 *     Losing the second opinion must not block completion; it is an addition to
 *     the gate, never a replacement for it.
 *
 * A lone dissenter loses the vote but is not thrown away: the verdict carries
 * `flagged`. One seat is measurably stricter than the other two (across 72
 * production votes: 24/24 pass, 23/1, 22/2), so a solo FAIL is the shape a real
 * catch arrives in, and burying it in an unexpanded panel list is how the only
 * discriminating vote gets lost.
 */
export function mergeVerdict(
  gate: { passed: boolean; reason: string },
  opinions: readonly VerificationOpinion[],
  at: number,
): TicketVerification {
  const voters = opinions.filter((o) => o.passed !== null);
  const fails = voters.filter((o) => o.passed === false);
  const passes = voters.filter((o) => o.passed === true);

  const panelVetoes = voters.length > 0 && fails.length * 2 > voters.length;
  const passed = gate.passed && !panelVetoes;

  // Everyone who landed on the final answer. The gate counts as a voter, but
  // only when the final answer is its own — an overruled gate is a dissenter.
  const agreeing = (passed ? passes : fails).length + (gate.passed === passed ? 1 : 0);
  const consensus: PanelConsensus = { agree: agreeing, total: voters.length + 1 };

  const reason = !gate.passed
    ? gate.reason || '게이트가 결과를 반려했습니다'
    : panelVetoes
      ? `패널 반려: ${fails.map((f) => f.reason).find(Boolean) ?? '목표 미달성'}`
      : gate.reason || '목표 달성';

  return {
    passed,
    reason,
    gate,
    ...(opinions.length > 0 ? { panel: [...opinions] } : {}),
    ...(passed && fails.length > 0 ? { flagged: true } : {}),
    consensus,
    at,
  };
}

export interface VerificationPanelDeps {
  panel: Panel;
  now?: () => number;
}

/**
 * Run the panel for a ticket and merge. Never throws: a panel-wide failure is
 * indistinguishable from "no panel configured", and both mean gate-only.
 */
export async function reviewWithPanel(
  deps: VerificationPanelDeps,
  ticket: Pick<Ticket, 'goal'>,
  report: string | null,
  gate: { passed: boolean; reason: string },
): Promise<TicketVerification> {
  const at = (deps.now ?? Date.now)();
  // Rule 1: a gate rejection is final — do not spend panel calls on it.
  if (!gate.passed) return mergeVerdict(gate, [], at);
  try {
    const members = await deps.panel.run({
      system: VERIFICATION_SYSTEM,
      user: buildVerificationPanelPrompt(ticket.goal, report),
    });
    return mergeVerdict(gate, members.map(toOpinion), at);
  } catch {
    return mergeVerdict(gate, [], at);
  }
}
