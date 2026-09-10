/**
 * Self-verification gate (spec §완료 판정). After the main agent finishes, a
 * second headless Claude judges whether the goal was actually met and emits a
 * strict JSON verdict. Because the process is invisible to the user, completion
 * is fail-closed: if the verifier can't produce a parseable verdict, the runner
 * treats the ticket as failed('verification-inconclusive'), never done.
 *
 * Fail-closed only works if the closure is rare and explicable. Measured over
 * 266 verified tickets it was neither: 14 (5.3%) ended inconclusive, every one of
 * them with a complete agent report, and all 14 recorded the same sentence —
 * "verification could not be completed" — because the cause was thrown away. So
 * this file now does three things it did not: retry once (the gate is a separate
 * process and its failures are mostly transient), carry the actual cause in the
 * error, and parse the verdict as tolerantly as the panel parses its own.
 *
 * The prompt asks for goal COVERAGE before the verdict for a measured reason.
 * Across 30 stored gate verdicts, 20 opened with some form of "verified
 * independently" and NOT ONE mentioned the goal: the gate had been checking
 * whether the report's claims were true, which is a different question from
 * whether the goal was met. That is what its 96.8% PASS precision actually
 * measures, and it is why the seven PASSes a human overturned were all reports
 * that were accurate about the wrong work. Asking for the weakest-covered part
 * first is the same lever that moved the LiteLLM panel from 0 vetoes to 2-of-7
 * on exactly those records.
 */
import type { Ticket, TicketVerification, TicketLocation } from '@claude-alive/core';
import { runHeadlessClaude, type HeadlessOutcome } from './headlessClaude.js';
import { reviewWithPanel } from './panel/verificationPanel.js';
import { extractJsonObject, type Panel } from './panel/litellmPanel.js';
import { VERDICT_LANGUAGE_RULE } from './verdictLanguage.js';

export interface Verifier {
  /** Resolves with a verdict, or throws if no parseable verdict could be obtained. */
  verify(ticket: Ticket, mainResult: string | null): Promise<TicketVerification>;
}

export interface VerifierOptions {
  /**
   * Injectable runner for tests; production resolves the ticket's Executor so the
   * verifier runs at the SAME location as the main agent (local or SSH).
   */
  run?: (opts: {
    goal: string;
    cwd: string;
    location?: TicketLocation;
    orchestrated?: boolean;
    /** Model/effort the ticket ran with; the gate inherits them (see `verify`). */
    flags?: { model?: string; effort?: string };
  }) => Promise<HeadlessOutcome>;
  /**
   * Independent LiteLLM reviewers layered on top of the Claude gate. Omitted
   * (no LITELLM_KEY) = gate-only, which is the pre-panel behaviour exactly.
   *
   * A function form is resolved per ticket, so a ticket whose content may not
   * leave the machine gets the gate alone while everything else gets the panel.
   */
  panel?: Panel | ((ticket: Ticket) => Panel | undefined);
  now?: () => number;
  /** Where a failed gate attempt is reported. Injectable so tests stay quiet. */
  log?: (message: string) => void;
}

/** How many times the gate is asked before the ticket is called inconclusive. */
export const GATE_ATTEMPTS = 2;

export function buildVerificationPrompt(goal: string, mainResult: string | null, orchestrated = false): string {
  const orchestrationNote = orchestrated
    ? [
        '',
        'NOTE: This was an ORCHESTRATION task. The agent is an orchestrator that may have',
        'delegated subtasks to sub-agents by running the `ca-delegate` tool (on PATH), which',
        'calls a remote model gateway over the network. Delegation therefore leaves NO local',
        'file artifacts — an empty working directory is EXPECTED and is not evidence of failure.',
        'Verify the REPORTED RESULT is coherent and satisfies the goal; do not demand local',
        'file changes or reject solely because `ca-delegate` output was network-based.',
      ]
    : [];
  return [
    'You are a strict verification agent. An autonomous agent was given a goal and reported a result.',
    'Independently inspect the working directory (build, tests, files, git diff as needed). Do not',
    'trust the report — verify.',
    ...orchestrationNote,
    '',
    `GOAL: ${goal}`,
    `REPORTED RESULT: ${mainResult ?? '(none)'}`,
    '',
    'Answer TWO questions, in this order.',
    '',
    'First, COVERAGE: restate the goal as its separate parts and say which part the work covers',
    'least. Every goal has one. Checking that the report\'s claims are TRUE is necessary but not',
    'sufficient — a report can be accurate about work that answers a different or smaller question',
    'than the one asked.',
    '',
    'Then the verdict. A goal with several parts FAILS unless the work covers all of them. Work that',
    'is real and correct but answers a different question than the goal FAILS. Do not pass something',
    'because its claims check out.',
    '',
    'Output ONLY a single JSON object on its own line, no prose, of the exact form:',
    '{"coverage": "<the least-covered part of the goal, one sentence>", "passed": true|false,',
    ' "reason": "<one concise sentence>"}',
    '',
    VERDICT_LANGUAGE_RULE,
  ].join('\n');
}

/**
 * Tolerant verdict extractor.
 *
 * The old flat-brace scan (`/\{[^{}]*"passed"[^{}]*\}/`) could not see a verdict
 * that carried any nested object, and a `reason` containing a brace broke it
 * outright — a parse failure that reads to the user as "the work failed". The
 * panel already had a parser for exactly this job (fenced blocks, prose around
 * the object, last object first), so the gate uses that one instead of a second,
 * weaker copy.
 */
export function extractVerdict(text: string | null): TicketVerification | null {
  if (!text) return null;
  const trimmed = text.trim();
  const obj = extractJsonObject(trimmed);
  if (obj && typeof obj.passed === 'boolean') {
    return {
      passed: obj.passed,
      reason: typeof obj.reason === 'string' ? obj.reason : '',
      ...(typeof obj.coverage === 'string' && obj.coverage ? { coverage: obj.coverage } : {}),
    };
  }
  // Last resort: the flat scan, which finds a verdict buried among other objects
  // that the balanced scan would have picked over it.
  for (const c of (trimmed.match(/\{[^{}]*"passed"[^{}]*\}/g) ?? []).reverse()) {
    try {
      const flat = JSON.parse(c) as Record<string, unknown>;
      if (typeof flat.passed === 'boolean') {
        return { passed: flat.passed, reason: typeof flat.reason === 'string' ? flat.reason : '' };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** What the gate returned when it produced no verdict, short enough to store. */
export function describeGateFailure(outcome: HeadlessOutcome): string {
  const body = (outcome.result?.result ?? '').trim();
  const stderr = outcome.stderr.trim();
  if (body) return `검증기가 판정 형식이 아닌 답을 냈습니다: ${body.slice(0, 300)}`;
  if (stderr) return `검증기가 출력을 내지 못했습니다 (exit ${outcome.exitCode}): ${stderr.slice(0, 300)}`;
  return `검증기가 출력을 내지 못했습니다 (exit ${outcome.exitCode})`;
}

export function createVerifier(options: VerifierOptions = {}): Verifier {
  // The fallback runner deliberately passes no model/effort flags: it spawns
  // `claude` directly, bypassing the executor's capability guard. Production
  // injects `run` (executor-backed), which is where flags are safe to use.
  const run =
    options.run ??
    (({ goal, cwd }) => runHeadlessClaude({ goal, cwd, permissionMode: 'bypassPermissions' }).done);

  const log = options.log ?? ((msg: string) => console.warn(msg));

  return {
    async verify(ticket, mainResult) {
      const ask = (): Promise<HeadlessOutcome> =>
        run({
          goal: buildVerificationPrompt(ticket.goal, mainResult, ticket.orchestrated),
          cwd: ticket.cwd,
          location: ticket.location,
          orchestrated: ticket.orchestrated,
          // The gate inherits the ticket's run profile. A verifier weaker than the
          // agent it judges would quietly hollow out the completion gate, so a
          // `deep` ticket is verified deeply and a `fast` one cheaply.
          flags: {
            ...(ticket.requestedModel ? { model: ticket.requestedModel } : {}),
            ...(ticket.effort ? { effort: ticket.effort } : {}),
          },
        });

      // Two attempts. The gate is a separate `claude` process on the far side of
      // a network and a CLI; when it produces nothing that is almost always a
      // transient failure of that process, not a judgement about the work — and
      // failing the ticket on it discards work that was already finished.
      let cause = '';
      for (let attempt = 1; attempt <= GATE_ATTEMPTS; attempt += 1) {
        let outcome: HeadlessOutcome;
        try {
          outcome = await ask();
        } catch (e) {
          cause = `verifier could not be started: ${e instanceof Error ? e.message : String(e)}`;
          log(`[verify] ticket #${ticket.seq} attempt ${attempt}/${GATE_ATTEMPTS}: ${cause}`);
          continue;
        }
        const verdict = extractVerdict(outcome.result?.result ?? null);
        if (verdict) return await withPanel(ticket, mainResult, verdict);
        cause = describeGateFailure(outcome);
        log(`[verify] ticket #${ticket.seq} attempt ${attempt}/${GATE_ATTEMPTS}: ${cause}`);
      }
      throw new Error(cause || '검증기가 판정을 내지 못했습니다');
    },
  };

  async function withPanel(
    ticket: Ticket,
    mainResult: string | null,
    verdict: TicketVerification,
  ): Promise<TicketVerification> {
    {
      // No panel for this ticket → the gate's verdict is the verdict, unchanged.
      const panel = typeof options.panel === 'function' ? options.panel(ticket) : options.panel;
      if (!panel) return verdict;
      return reviewWithPanel(
        { panel, ...(options.now ? { now: options.now } : {}) },
        ticket,
        mainResult,
        verdict,
      );
    }
  }
}
