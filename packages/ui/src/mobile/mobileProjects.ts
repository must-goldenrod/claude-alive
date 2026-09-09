/**
 * Which projects the phone may target.
 *
 * The server's allowlist is the answer whenever it has one — that is the set a
 * remote device is actually permitted to run in. A local-only server has no
 * allowlist configured, and an empty picker would make the composer useless, so
 * the fallback is the directories tickets have already run in: the same places,
 * discovered rather than declared.
 */
import type { Ticket } from '@claude-alive/core';
import { projectName } from '../views/tickets/ticketDisplay.ts';
import type { MobileProject } from './types.ts';

export function mergeProjects(allowed: MobileProject[], tickets: readonly Ticket[]): MobileProject[] {
  if (allowed.length > 0) return allowed;
  const lastSeen = new Map<string, number>();
  for (const ticket of tickets) {
    if (!ticket.cwd) continue;
    const at = Math.max(ticket.endedAt ?? 0, ticket.startedAt ?? 0, ticket.createdAt);
    lastSeen.set(ticket.cwd, Math.max(lastSeen.get(ticket.cwd) ?? 0, at));
  }
  return [...lastSeen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => ({ path, name: projectName(path) }));
}
