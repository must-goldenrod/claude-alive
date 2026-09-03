/**
 * Who may be shown to the review panels.
 *
 * Both panels send a ticket's goal and the agent's own report to third-party
 * model providers. That is fine for most work and unacceptable for some, so the
 * panels are opt-out at two levels: a single ticket turns them off at creation,
 * and an operator turns them off for whole directory trees with
 * `CLAUDE_ALIVE_PANEL_EXCLUDE` (colon-separated absolute paths).
 *
 * Excluded tickets are not degraded in any other way — they still run the local
 * Claude gate, and a decision they raise simply waits for a human, which is the
 * behaviour every ticket had before the panels existed.
 */
import { resolve, sep } from 'node:path';
import type { Ticket } from '@claude-alive/core';

/** `CLAUDE_ALIVE_PANEL_EXCLUDE=/a:/b` → normalized absolute roots. */
export function parsePanelExcludedRoots(env: NodeJS.ProcessEnv): string[] {
  return (env.CLAUDE_ALIVE_PANEL_EXCLUDE ?? '')
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => resolve(p));
}

/** True when `cwd` is one of the roots or sits inside one. */
export function isUnderRoot(cwd: string, roots: readonly string[]): boolean {
  if (roots.length === 0) return false;
  const target = resolve(cwd);
  return roots.some((root) => target === root || target.startsWith(root.endsWith(sep) ? root : root + sep));
}

/**
 * Whether this ticket's content may leave the machine.
 *
 * Fail-closed on the ticket's own flag: only an explicit `false` disables, but a
 * cwd under an excluded root disables regardless of what the ticket asked for —
 * the operator's boundary is not something a ticket can opt back into.
 */
export function panelAllowedFor(ticket: Pick<Ticket, 'cwd' | 'panelReview'>, excludedRoots: readonly string[]): boolean {
  if (ticket.panelReview === false) return false;
  return !isUnderRoot(ticket.cwd, excludedRoots);
}
