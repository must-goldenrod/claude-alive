import type { AgentInfo, AgentState, ToolAnimation } from '../events/types.js';
import type { EventLogEntry } from '../state/sessionStore.js';

export type WSServerMessage =
  | { type: 'agent:spawn'; agent: AgentInfo }
  | { type: 'agent:despawn'; sessionId: string }
  | { type: 'agent:state'; sessionId: string; state: AgentState; tool: string | null; animation: ToolAnimation | null }
  | { type: 'agent:prompt'; sessionId: string; prompt: string }
  | { type: 'event:new'; entry: EventLogEntry }
  | { type: 'snapshot'; agents: AgentInfo[]; recentEvents: EventLogEntry[] }
  | { type: 'system:heartbeat'; timestamp: number };

export type WSClientMessage =
  | { type: 'ping' }
  | { type: 'request:snapshot' };
