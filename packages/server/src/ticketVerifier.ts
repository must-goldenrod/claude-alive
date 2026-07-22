/**
 * Self-verification gate (spec §완료 판정). After the main agent finishes, a
 * second headless Claude judges whether the goal was actually met and emits a
 * strict JSON verdict. Because the process is invisible to the user, completion
 * is fail-closed: if the verifier can't produce a parseable verdict, the runner
 * treats the ticket as failed('verification-inconclusive'), never done.
 */
import type { Ticket, TicketVerification, TicketLocation } from '@claude-alive/core';
import { runHeadlessClaude, type HeadlessOutcome } from './headlessClaude.js';

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
  }) => Promise<HeadlessOutcome>;
}

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
    'Independently inspect the working directory (build, tests, files, git diff as needed) and decide',
    'whether the goal was ACTUALLY achieved. Do not trust the report — verify.',
    ...orchestrationNote,
    '',
    `GOAL: ${goal}`,
    `REPORTED RESULT: ${mainResult ?? '(none)'}`,
    '',
    'Output ONLY a single JSON object on its own line, no prose, of the exact form:',
    '{"passed": true|false, "reason": "<one concise sentence>"}',
  ].join('\n');
}

/** Tolerant verdict extractor: accepts a bare object or one embedded in surrounding text. */
export function extractVerdict(text: string | null): TicketVerification | null {
  if (!text) return null;
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);
  // Also try the last {...} block in case the model wrapped it in prose.
  const matches = trimmed.match(/\{[^{}]*"passed"[^{}]*\}/g);
  if (matches) candidates.push(...matches.reverse());

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as Record<string, unknown>;
      if (typeof obj.passed === 'boolean') {
        return { passed: obj.passed, reason: typeof obj.reason === 'string' ? obj.reason : '' };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function createVerifier(options: VerifierOptions = {}): Verifier {
  const run =
    options.run ??
    (({ goal, cwd }) => runHeadlessClaude({ goal, cwd, permissionMode: 'bypassPermissions' }).done);

  return {
    async verify(ticket, mainResult) {
      const outcome = await run({
        goal: buildVerificationPrompt(ticket.goal, mainResult, ticket.orchestrated),
        cwd: ticket.cwd,
        location: ticket.location,
        orchestrated: ticket.orchestrated,
      });
      const verdict = extractVerdict(outcome.result?.result ?? null);
      if (!verdict) {
        throw new Error('verifier produced no parseable verdict');
      }
      return verdict;
    },
  };
}
