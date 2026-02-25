import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, ToolAnimation, WSServerMessage } from '@claude-alive/core';
import type { AgentVisualState } from '../components/AgentModel';

export interface BattleAgent {
  sessionId: string;
  position: [number, number, number];
  color: string;
  state: AgentVisualState;
  toolAnimation: string | null;
  selected: boolean;
}

// Palette for assigning distinct colors to agents
const AGENT_COLORS = [
  '#448aff', '#00c853', '#7c4dff', '#ff6d00',
  '#00bcd4', '#e91e63', '#ffab00', '#76ff03',
];

// Place agents in a grid pattern on the battlefield
function assignGridPosition(index: number): [number, number, number] {
  const cols = 4;
  const spacing = 3;
  const offsetX = -((cols - 1) * spacing) / 2;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return [offsetX + col * spacing, 0, -4 + row * spacing];
}

function mapAgentState(state: AgentState): AgentVisualState {
  switch (state) {
    case 'active':
    case 'listening':
      return 'active';
    case 'waiting':
    case 'spawning':
    case 'despawning':
      return 'waiting';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

interface BattlefieldState {
  agents: BattleAgent[];
  connected: boolean;
  selectedAgent: BattleAgent | null;
  selectAgent: (sessionId: string | null) => void;
}

export function useBattlefieldState(url: string): BattlefieldState {
  const [agentMap, setAgentMap] = useState<Map<string, BattleAgent>>(new Map());
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const indexCounter = useRef(0);
  const indexMap = useRef<Map<string, number>>(new Map());

  const getIndex = useCallback((sessionId: string): number => {
    let idx = indexMap.current.get(sessionId);
    if (idx === undefined) {
      idx = indexCounter.current++;
      indexMap.current.set(sessionId, idx);
    }
    return idx;
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSServerMessage;

      setAgentMap(prev => {
        const next = new Map(prev);

        switch (msg.type) {
          case 'snapshot': {
            next.clear();
            indexMap.current.clear();
            indexCounter.current = 0;
            for (const agent of msg.agents) {
              const idx = getIndex(agent.sessionId);
              next.set(agent.sessionId, {
                sessionId: agent.sessionId,
                position: assignGridPosition(idx),
                color: AGENT_COLORS[idx % AGENT_COLORS.length],
                state: mapAgentState(agent.state),
                toolAnimation: agent.currentToolAnimation,
                selected: false,
              });
            }
            break;
          }
          case 'agent:spawn': {
            const idx = getIndex(msg.agent.sessionId);
            next.set(msg.agent.sessionId, {
              sessionId: msg.agent.sessionId,
              position: assignGridPosition(idx),
              color: AGENT_COLORS[idx % AGENT_COLORS.length],
              state: mapAgentState(msg.agent.state),
              toolAnimation: msg.agent.currentToolAnimation,
              selected: false,
            });
            break;
          }
          case 'agent:despawn': {
            next.delete(msg.sessionId);
            indexMap.current.delete(msg.sessionId);
            break;
          }
          case 'agent:state': {
            const existing = next.get(msg.sessionId);
            if (existing) {
              next.set(msg.sessionId, {
                ...existing,
                state: mapAgentState(msg.state as AgentState),
                toolAnimation: msg.animation as ToolAnimation | null,
              });
            }
            break;
          }
          case 'agent:prompt':
          case 'event:new':
          case 'system:heartbeat':
            break;
        }

        return next;
      });
    };
  }, [url, getIndex]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const agents = Array.from(agentMap.values()).map(a => ({
    ...a,
    selected: a.sessionId === selectedId,
  }));
  const selectedAgent = agents.find(a => a.selected) ?? null;

  return { agents, connected, selectedAgent, selectAgent: setSelectedId };
}
