/**
 * Correlates a canonical session with its server-owned terminal (§F.7, §I.1.1).
 *
 * A session and a terminal are different objects: a tab can close while the
 * session survives, and an externally-started Claude session has no Alive-owned
 * pty at all. The Terminal tab therefore has to answer "is there one, and is it
 * still running", and say *why* when there is not — a blank pane would leave the
 * user unable to tell "no output yet" from "we never owned this process".
 *
 * The lookups are injected so this stays pure and testable; the server supplies
 * the session-ref store, the managed-session registry, and the terminal manager.
 */

export type TerminalUnavailableReason = 'unknown-session' | 'not-spawned-by-alive' | 'lookup-failed';

export interface SessionTerminalLink {
  available: boolean;
  live: boolean;
  tabId?: string;
  reason?: TerminalUnavailableReason;
}

export interface SessionTerminalDeps {
  /** Alive session id → provider reference. */
  findProviderRef: (sessionId: string) => { provider: string; providerSessionId: string } | undefined;
  /** Provider session id → terminal tab id, when Alive spawned it. */
  findTabId: (providerSessionId: string) => string | undefined;
  isLive: (tabId: string) => boolean;
}

export function resolveSessionTerminal(sessionId: string, deps: SessionTerminalDeps): SessionTerminalLink {
  try {
    const ref = deps.findProviderRef(sessionId);
    if (!ref) return { available: false, live: false, reason: 'unknown-session' };

    const tabId = deps.findTabId(ref.providerSessionId);
    if (!tabId) {
      // Started outside Alive (plain CLI elsewhere): the conversation is still
      // readable from hooks, but there is no pty of ours to attach to.
      return { available: false, live: false, reason: 'not-spawned-by-alive' };
    }

    return { available: true, live: deps.isLive(tabId), tabId };
  } catch {
    // A failing lookup must not surface as "no terminal", which would be a
    // different (and wrong) fact.
    return { available: false, live: false, reason: 'lookup-failed' };
  }
}
