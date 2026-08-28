import type { Run } from '@claude-alive/core';

/**
 * "Open" means something different per run kind, and the thing that opens it
 * lives in a different view each time. The sidebar cannot reach any of them
 * directly, so it states an intent and the shell routes it.
 */
export type OpenRunIntent =
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'terminal'; tabId: string }
  | { kind: 'agent'; sessionId: string };

export const OPEN_RUN_EVENT = 'claude-alive:open-run';

/** What opening this run should surface. */
export function openRunIntent(run: Run): OpenRunIntent {
  switch (run.kind) {
    case 'ticket':
      return { kind: 'ticket', ticketId: run.sourceId };
    case 'terminal':
      return { kind: 'terminal', tabId: run.sourceId };
    case 'agent':
      return { kind: 'agent', sessionId: run.sourceId };
  }
}

export function dispatchOpenRun(run: Run): void {
  window.dispatchEvent(new CustomEvent(OPEN_RUN_EVENT, { detail: openRunIntent(run) }));
}
