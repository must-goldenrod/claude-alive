/**
 * Where a phone resumes an exited Claude session.
 *
 * After a reboot every pty is gone. The desktop resumes its own tabs from
 * localStorage, but a phone has its own storage and used to show only "this
 * terminal has exited" — no way back into the conversation. The server still
 * knows the session id (a `terminal:dormant` reply, or the catalog's provider
 * id), which is all `claude --resume` needs.
 */
import type { MobileSession } from './MobileSessionList.tsx';

export interface ResumeTarget {
  tabId: string;
  claudeSessionId: string;
  cwd: string;
  origin: 'desktop' | 'mobile';
}

export function resumeTarget(
  session: MobileSession,
  attachedTab: string | null,
  /** Session id from a `terminal:dormant` reply; wins over the catalog's. */
  dormantSessionId: string | null,
  newTabId: () => string,
): ResumeTarget | null {
  const claudeSessionId = dormantSessionId ?? session.providerSessionId;
  if (!claudeSessionId || !session.cwd) return null;
  // Reuse the tab the desktop already has for it, so both devices land on one pty.
  if (attachedTab) return { tabId: attachedTab, claudeSessionId, cwd: session.cwd, origin: session.origin ?? 'desktop' };
  return { tabId: newTabId(), claudeSessionId, cwd: session.cwd, origin: 'mobile' };
}
