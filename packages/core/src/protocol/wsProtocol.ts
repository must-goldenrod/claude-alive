import type { AgentInfo, AgentState, CompletedSession, ToolAnimation } from '../events/types.js';
import type { AgentStats, EventLogEntry } from '../state/sessionStore.js';
import type { EfficioStatus } from '../efficio/types.js';

export type TerminalMode = 'claude' | 'shell';
export type TerminalSource = 'local' | 'ssh';

export type SSHErrorKind =
  | 'permission-denied'
  | 'connection-refused'
  | 'dns'
  | 'timeout'
  | 'host-key'
  | 'host-key-changed'
  | 'unknown';

/**
 * A managed Claude session that the server spawned and persisted to disk, but
 * whose pty is no longer running (server was restarted). The UI can offer to
 * resume it via `claude --resume <claudeSessionId>`.
 */
export interface ResumableSession {
  tabId: string;
  claudeSessionId: string;
  cwd?: string;
  displayName?: string;
  mode: TerminalMode;
  claudeVariant: 'claude' | 'agents';
  lastActive: number;
}

export type WSServerMessage =
  /**
   * Canonical (v2) catalog invalidation. Carries no payload on purpose: the tree
   * is fetched over HTTP, so the socket protocol never has to version the read
   * model. Clients that do not know this type ignore it.
   */
  | { type: 'v2:catalog-changed' }
  | { type: 'agent:spawn'; agent: AgentInfo }
  | { type: 'agent:despawn'; sessionId: string }
  | { type: 'agent:state'; sessionId: string; state: AgentState; tool: string | null; animation: ToolAnimation | null; timestamp: number }
  | { type: 'agent:prompt'; sessionId: string; prompt: string }
  | { type: 'agent:rename'; sessionId: string; name: string | null }
  | { type: 'agent:completed'; session: CompletedSession }
  | { type: 'event:new'; entry: EventLogEntry }
  | { type: 'stats:update'; stats: AgentStats }
  | { type: 'snapshot'; agents: AgentInfo[]; recentEvents: EventLogEntry[]; completedSessions: CompletedSession[]; stats: AgentStats; resumableSessions: ResumableSession[] }
  | { type: 'system:heartbeat'; timestamp: number }
  | { type: 'system:metrics'; cpu: number; memUsed: number; memTotal: number; timestamp: number }
  | { type: 'terminal:output'; tabId: string; data: string }
  | { type: 'terminal:exited'; tabId: string; exitCode: number }
  | { type: 'terminal:ssh-error'; tabId: string; kind: SSHErrorKind; line: string }
  // Sent in response to `terminal:attach` when the pty is still alive: replays
  // the scrollback ring buffer so the reattaching browser restores its screen.
  | { type: 'terminal:restore'; tabId: string; data: string }
  // Sent in response to `terminal:attach` when the pty is gone (server restart).
  // The UI can offer to resume the conversation via `claude --resume`.
  | { type: 'terminal:dormant'; tabId: string; claudeSessionId: string }
  // Sent in response to `terminal:attach` when the server has neither a live pty
  // nor a persisted record for this tab (its managed-session record was lost or
  // predates persistence). The client resumes from its OWN persisted
  // claudeSessionId so a restored tab is never left blank.
  | { type: 'terminal:missing'; tabId: string }
  // Broadcast when the set of resumable (dormant) sessions changes.
  | { type: 'sessions:resumable'; sessions: ResumableSession[] }
  | { type: 'project:names'; names: Record<string, string> }
  | { type: 'efficio:update'; status: EfficioStatus };

export type WSClientMessage =
  | { type: 'ping' }
  | { type: 'request:snapshot' }
  | {
      type: 'terminal:spawn';
      tabId: string;
      cwd?: string;
      skipPermissions?: boolean;
      mode?: TerminalMode;
      source?: TerminalSource;
      initialCommand?: string;
      /** Which Claude CLI entrypoint to run: `claude` (default) or `claude agents`. Only meaningful when mode is 'claude'. */
      claudeVariant?: 'claude' | 'agents';
      /** UUID to pass via `claude --session-id` so the tab and Claude session are 1:1 matched. */
      claudeSessionId?: string;
      /** Pre-existing Claude session UUID to resume via `claude --resume`. Wins over claudeSessionId. */
      resumeSessionId?: string;
      /** Initial display name passed via `claude -n`. Appears in /resume picker and prompt. */
      displayName?: string;
    }
  | { type: 'terminal:input'; tabId: string; data: string }
  | { type: 'terminal:resize'; tabId: string; cols: number; rows: number }
  | { type: 'terminal:close'; tabId: string }
  // Reattach to a server-owned terminal after a browser refresh. The server
  // replies with `terminal:restore` (pty alive) or `terminal:dormant` (pty gone).
  | { type: 'terminal:attach'; tabId: string };
