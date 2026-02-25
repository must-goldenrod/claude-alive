import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentInfo, AgentState, ToolAnimation, EventLogEntry, WSServerMessage } from '@claude-alive/core';

export interface DashboardState {
  agents: Map<string, AgentInfo>;
  events: EventLogEntry[];
  connected: boolean;
}

export function useWebSocket(url: string) {
  const [state, setState] = useState<DashboardState>({
    agents: new Map(),
    events: [],
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

      setState(prev => {
        const agents = new Map(prev.agents);
        let events = prev.events;

        switch (msg.type) {
          case 'snapshot': {
            agents.clear();
            for (const agent of msg.agents) {
              agents.set(agent.sessionId, agent);
            }
            events = msg.recentEvents;
            break;
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
              agents.set(msg.sessionId, {
                ...agent,
                state: msg.state as AgentState,
                currentTool: msg.tool,
                currentToolAnimation: msg.animation as ToolAnimation | null,
              });
            }
            break;
          }
          case 'agent:prompt': {
            // Could track last prompt per agent if needed
            break;
          }
          case 'event:new': {
            events = [...events.slice(-199), msg.entry];
            break;
          }
          case 'system:heartbeat': {
            // Connection alive
            break;
          }
        }

        return { agents, events, connected: true };
      });
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}
