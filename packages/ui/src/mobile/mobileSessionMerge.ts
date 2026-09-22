/**
 * One list out of two sources: the session catalog and the server's terminals.
 *
 * The catalog knows every Claude session this machine has ever run, but not
 * which of them still has a pty. The terminal index knows every live pty,
 * including plain shells the catalog never hears about — and, now that it
 * exists, the terminals another device opened. Neither list alone is what a
 * phone needs to look at.
 *
 * They overlap on `providerSessionId`, which the catalog reports and a Claude
 * terminal records as its `claudeSessionId`. Rows that match are one row, with
 * the catalog's title and the terminal's tab; rows that do not are appended.
 */
import type { MobileSession } from './MobileSessionList.tsx';

export interface TerminalRow {
  tabId: string;
  origin?: 'desktop' | 'mobile';
  claudeSessionId?: string;
  cwd?: string;
  displayName?: string;
  mode?: string;
  live: boolean;
  lastActivityAt: number;
}

export function mergeSessions(catalog: MobileSession[], terminals: TerminalRow[]): MobileSession[] {
  const byProvider = new Map<string, TerminalRow>();
  for (const terminal of terminals) {
    if (terminal.claudeSessionId) byProvider.set(terminal.claudeSessionId, terminal);
  }

  const claimed = new Set<string>();
  const merged = catalog.map((session) => {
    const terminal = session.providerSessionId ? byProvider.get(session.providerSessionId) : undefined;
    if (!terminal) return session;
    claimed.add(terminal.tabId);
    return {
      ...session,
      tabId: terminal.tabId,
      origin: terminal.origin ?? 'desktop',
      terminalLive: terminal.live,
      lastActivityAt: Math.max(session.lastActivityAt, terminal.lastActivityAt),
    };
  });

  // A pty with no catalog row: a plain shell, or a session started on another
  // device before its hooks reached this machine. Either way it is openable,
  // which is more than the catalog row would have been.
  const extra: MobileSession[] = terminals
    .filter((terminal) => !claimed.has(terminal.tabId))
    .map((terminal) => ({
      sessionId: terminal.tabId,
      displayName: terminal.displayName ?? '',
      state: terminal.live ? 'running' : 'exited',
      cwd: terminal.cwd ?? '',
      lastActivityAt: terminal.lastActivityAt,
      needsApproval: false,
      tabId: terminal.tabId,
      origin: terminal.origin ?? 'desktop',
      terminalLive: terminal.live,
    }));

  return [...merged, ...extra];
}
