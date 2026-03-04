import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentInfo, AgentState, CompletedSession, ToolAnimation, EventLogEntry, WSServerMessage, WSClientMessage, AgentStats } from '@claude-alive/core';

export interface DashboardState {
  agents: Map<string, AgentInfo>;
  events: EventLogEntry[];
  completedSessions: CompletedSession[];
  stats: AgentStats | null;
  connected: boolean;
}

export function useWebSocket(url: string, onRawMessage?: (msg: WSServerMessage) => void) {
  const [state, setState] = useState<DashboardState>({
    agents: new Map(),
    events: [],
    completedSessions: [],
    stats: null,
    connected: false,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
    };

    ws.onclose = () => {
      setState(prev => ({ ...prev, connected: false }));
      // Reconnect after 2s
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSServerMessage;
      onRawMessage?.(msg);

      setState(prev => {
        const agents = new Map(prev.agents);
        let events = prev.events;
        let completedSessions = prev.completedSessions;

        switch (msg.type) {
          case 'snapshot': {
            agents.clear();
            for (const agent of msg.agents) {
              agents.set(agent.sessionId, agent);
            }
            events = msg.recentEvents;
            completedSessions = msg.completedSessions ?? [];
            return { agents, events, completedSessions, stats: msg.stats ?? null, connected: true };
          }
          case 'agent:spawn': {
            agents.set(msg.agent.sessionId, msg.agent);
            break;
          }
          case 'agent:despawn': {
            agents.delete(msg.sessionId);
            break;
          }
          case 'agent:state': {
            const agent = agents.get(msg.sessionId);
            if (agent) {
              const toolsUsed = msg.tool && !agent.toolsUsed.includes(msg.tool)
                ? [...agent.toolsUsed, msg.tool]
                : agent.toolsUsed;
              agents.set(msg.sessionId, {
                ...agent,
                state: msg.state as AgentState,
                currentTool: msg.tool,
                currentToolAnimation: msg.animation as ToolAnimation | null,
                lastEventTime: msg.timestamp ?? agent.lastEventTime,
                totalEvents: agent.totalEvents + 1,
                toolsUsed,
              });
            }
            break;
          }
          case 'agent:prompt': {
            const pa = agents.get(msg.sessionId);
            if (pa) {
              agents.set(msg.sessionId, { ...pa, lastPrompt: msg.prompt });
            }
            break;
          }
          case 'agent:rename': {
            const ra = agents.get(msg.sessionId);
            if (ra) {
              agents.set(msg.sessionId, { ...ra, displayName: msg.name });
            }
            break;
          }
          case 'agent:completed': {
            completedSessions = [...completedSessions, msg.session];
            break;
          }
          case 'event:new': {
            events = [...events.slice(-199), msg.entry];
            const ea = agents.get(msg.entry.sessionId);
            if (ea) {
              const toolsUsed = msg.entry.tool && !ea.toolsUsed.includes(msg.entry.tool)
                ? [...ea.toolsUsed, msg.entry.tool]
                : ea.toolsUsed;
              agents.set(msg.entry.sessionId, {
                ...ea,
                lastEventTime: msg.entry.timestamp,
                totalEvents: ea.totalEvents + 1,
                toolsUsed,
              });
            }
            break;
          }
          case 'stats:update': {
            return { ...prev, stats: msg.stats };
          }
          case 'system:heartbeat': {
            // Connection alive
            break;
          }
        }

        return { agents, events, completedSessions, stats: prev.stats, connected: true };
      });
    };
  }, [url, onRawMessage]);

  const send = useCallback((msg: WSClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { ...state, send };
}
