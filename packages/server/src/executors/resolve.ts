/**
 * Pick the Executor for a ticket's location: local child process, or SSH to a
 * remote host. Absent location = local (backward-compatible).
 */
import type { TicketLocation } from '@claude-alive/core';
import { createLocalExecutor } from './localExecutor.js';
import { createSshExecutor } from './sshExecutor.js';
import type { Executor } from './types.js';

export interface ResolveExecutorDeps {
  /** Allowlist applied to LOCAL tickets (from CLAUDE_ALIVE_TICKET_ROOTS). */
  localAllowedRoots?: readonly string[];
}

export function resolveExecutor(location: TicketLocation | undefined, deps: ResolveExecutorDeps = {}): Executor {
  if (location?.kind === 'ssh' && location.ssh) {
    return createSshExecutor(location.ssh);
  }
  return createLocalExecutor({ allowedRoots: deps.localAllowedRoots });
}
