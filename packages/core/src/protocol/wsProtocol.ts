import type { AgentInfo, AgentState, CompletedSession, ToolAnimation } from '../events/types.js';
import type { AgentStats, EventLogEntry } from '../state/sessionStore.js';

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
  | { type: 'chat:chunk'; text: string; sessionId: string }
  | { type: 'chat:end'; sessionId: string; costUsd?: number }
  | { type: 'chat:error'; error: string; sessionId: string | null };

export type WSClientMessage =
  | { type: 'ping' }
  | { type: 'request:snapshot' }
  | { type: 'chat:send'; message: string };
