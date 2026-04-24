import type { AgentInfo, AgentState, CompletedSession, ToolAnimation } from '../events/types.js';
import type { AgentStats, EventLogEntry } from '../state/sessionStore.js';

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

export type WSServerMessage =
  | { type: 'agent:spawn'; agent: AgentInfo }
  | { type: 'agent:despawn'; sessionId: string }
  | { type: 'agent:state'; sessionId: string; state: AgentState; tool: string | null; animation: ToolAnimation | null; timestamp: number }
  | { type: 'agent:prompt'; sessionId: string; prompt: string }
  | { type: 'agent:rename'; sessionId: string; name: string | null }
  | { type: 'agent:completed'; session: CompletedSession }
  | { type: 'event:new'; entry: EventLogEntry }
  | { type: 'stats:update'; stats: AgentStats }
  | { type: 'snapshot'; agents: AgentInfo[]; recentEvents: EventLogEntry[]; completedSessions: CompletedSession[]; stats: AgentStats }
  | { type: 'system:heartbeat'; timestamp: number }
  | { type: 'system:metrics'; cpu: number; memUsed: number; memTotal: number; timestamp: number }
  | { type: 'terminal:output'; tabId: string; data: string }
  | { type: 'terminal:exited'; tabId: string; exitCode: number }
  | { type: 'terminal:ssh-error'; tabId: string; kind: SSHErrorKind; line: string }
  | { type: 'project:names'; names: Record<string, string> };

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
      /** UUID to pass via `claude --session-id` so the tab and Claude session are 1:1 matched. */
      claudeSessionId?: string;
      /** Pre-existing Claude session UUID to resume via `claude --resume`. Wins over claudeSessionId. */
      resumeSessionId?: string;
      /** Initial display name passed via `claude -n`. Appears in /resume picker and prompt. */
      displayName?: string;
    }
  | { type: 'terminal:input'; tabId: string; data: string }
  | { type: 'terminal:resize'; tabId: string; cols: number; rows: number }
  | { type: 'terminal:close'; tabId: string };
