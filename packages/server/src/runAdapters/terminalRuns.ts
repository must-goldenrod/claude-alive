import type { ResolvedLocation } from '../gitResolver.js';
import type { RunUpsert } from '../runStore.js';

export interface TerminalTabFacts {
  tabId: string;
  cwd: string;
  title: string;
  startedAt: number;
}

/** Terminal tab → Run. A live pty is always `running`; only a human closes it. */
export function terminalToUpsert(tab: TerminalTabFacts, location: ResolvedLocation): RunUpsert {
  return {
    runId: `terminal:${tab.tabId}`,
    location,
    kind: 'terminal',
    sourceId: tab.tabId,
    title: tab.title,
    state: 'running',
    startedAt: tab.startedAt,
  };
}
