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
 * claim from the goal + report + gate verdict, with no filesystem access. They
 * cannot confirm a fact the gate missed, but they can refuse a report that does
 * not actually answer the goal — which is the failure mode the gate shares with
 * the worker.
 */
import type { Ticket, TicketVerification, VerificationOpinion, PanelConsensus } from '@claude-alive/core';
import { extractJsonObject, readString, type Panel, type PanelMemberResult } from './litellmPanel.js';

export const VERIFICATION_SYSTEM = [
  'You are an independent verification reviewer on a panel of several models.',
  'You are judging whether an autonomous agent ACTUALLY achieved the goal it was given.',
  'You have NO filesystem access: judge only from the goal, the agent\'s report, and the',
  'first reviewer\'s findings. Be strict about one thing above all — whether the report',
  'answers the GOAL AS STATED. A report that is coherent but solves a different or smaller',
  'problem than the goal must FAIL. Do not invent facts you cannot see; if the report is',
  'too thin to judge, that is itself a FAIL.',
  '',
  'Answer with ONE JSON object and nothing else:',
  '{"passed": true|false, "reason": "<one concise sentence, English or Korean>"}',
].join('\n');

/** Cap on the report text sent to reviewers; a huge body starves the question. */
const MAX_REPORT_CHARS = 12_000;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

export function buildVerificationPanelPrompt(
  goal: string,
  report: string | null,
  gate: { passed: boolean; reason: string },
): string {
  return [
    `GOAL:\n${goal}`,
    '',
    `AGENT REPORT:\n${report ? clip(report, MAX_REPORT_CHARS) : '(none)'}`,
    '',
    `FIRST REVIEWER (had filesystem access) SAID: ${gate.passed ? 'PASS' : 'FAIL'} — ${gate.reason || '(no reason)'}`,
    '',
    'Do you agree the goal was achieved?',
  ].join('\n');
}

/** Turn one raw panel answer into a vote. An unparseable answer abstains. */
export function toOpinion(member: PanelMemberResult): VerificationOpinion {
  if (member.content === null) {
    return { model: member.model, passed: null, reason: '', error: member.error ?? 'no answer' };
  }
  const obj = extractJsonObject(member.content);
  const passed = obj && typeof obj.passed === 'boolean' ? obj.passed : null;
  if (passed === null) {
    return {
      model: member.model,
      ...(member.respondedModel ? { respondedModel: member.respondedModel } : {}),
      passed: null,
      reason: '',
      error: 'no parseable verdict',
    };
  }
  return {
    model: member.model,
    ...(member.respondedModel ? { respondedModel: member.respondedModel } : {}),
    passed,
    reason: (obj && readString(obj, 'reason')) ?? '',
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
    ? gate.reason || 'gate rejected the result'
    : panelVetoes
      ? `panel rejected: ${fails.map((f) => f.reason).find(Boolean) ?? 'goal not met'}`
      : gate.reason || 'goal met';

  return {
    passed,
    reason,
    gate,
    ...(opinions.length > 0 ? { panel: [...opinions] } : {}),
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
      user: buildVerificationPanelPrompt(ticket.goal, report, gate),
    });
    return mergeVerdict(gate, members.map(toOpinion), at);
  } catch {
    return mergeVerdict(gate, [], at);
  }
}
