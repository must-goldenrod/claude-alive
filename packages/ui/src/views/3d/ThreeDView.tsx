import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInfo, AgentState, ToolAnimation, EventLogEntry, WSServerMessage } from '@claude-alive/core';
import { StatsBar } from '../dashboard/components/StatsBar.tsx';
import { AgentCard } from '../dashboard/components/AgentCard.tsx';
import { BattlefieldScene } from './components/BattlefieldScene.tsx';
import { AgentModel } from './components/AgentModel.tsx';
import { ToolParticles } from './components/ToolParticles.tsx';
import type { AgentVisualState } from './components/AgentModel.tsx';

// ── WebSocket ────────────────────────────────────────────────────────────

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

// ── Map AgentInfo to 3D positions ────────────────────────────────────────

const AGENT_COLORS = [
  '#448aff', '#00c853', '#7c4dff', '#ff6d00',
  '#00bcd4', '#e91e63', '#ffab00', '#76ff03',
];

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

// ── Resizable divider ────────────────────────────────────────────────────

function useDivider(initialRatio: number) {
  const [ratio, setRatio] = useState(initialRatio);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newRatio = Math.max(0.15, Math.min(0.85, ev.clientY / window.innerHeight));
      setRatio(newRatio);
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  return { ratio, onMouseDown };
}

// ── Component ────────────────────────────────────────────────────────────

export function ThreeDView() {
  const { t } = useTranslation();
  const wsUrl = useMemo(getWsUrl, []);

  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as WSServerMessage;

      setAgents(prev => {
        const next = new Map(prev);
        switch (msg.type) {
          case 'snapshot': {
            next.clear();
            for (const agent of msg.agents) {
              next.set(agent.sessionId, agent);
            }
            setEvents(msg.recentEvents);
            break;
          }
          case 'agent:spawn':
            next.set(msg.agent.sessionId, msg.agent);
            break;
          case 'agent:despawn':
            next.delete(msg.sessionId);
            break;
          case 'agent:state': {
            const agent = next.get(msg.sessionId);
            if (agent) {
              next.set(msg.sessionId, {
                ...agent,
                state: msg.state as AgentState,
                currentTool: msg.tool,
                currentToolAnimation: msg.animation as ToolAnimation | null,
              });
            }
            break;
          }
          case 'event:new':
            setEvents(prev => [...prev.slice(-199), msg.entry]);
            break;
          case 'agent:prompt':
          case 'system:heartbeat':
            break;
        }
        return next;
      });
    };
  }, [wsUrl]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const { ratio, onMouseDown } = useDivider(0.35);
  const agentList = Array.from(agents.values());

  const battleAgents = useMemo(() => {
    return agentList.map((agent, i) => ({
      sessionId: agent.sessionId,
      position: assignGridPosition(i) as [number, number, number],
      color: AGENT_COLORS[i % AGENT_COLORS.length],
      state: mapAgentState(agent.state),
    }));
  }, [agentList]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top panel: dashboard */}
      <div
        style={{
          height: `${ratio * 100}%`,
          overflow: 'auto',
          background: 'var(--bg-primary)',
        }}
      >
        <div className="p-4 space-y-4 max-w-screen-2xl mx-auto w-full">
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
                boxShadow: connected ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-red)',
              }}
            />
            <span>{connected ? t('header.connected') : t('header.disconnected')}</span>
            <span style={{ marginLeft: 'auto' }}>{t('header.agentCount', { count: agentList.length })}</span>
          </div>

          <StatsBar agents={agentList} events={events} />

          {agentList.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {agentList.map(agent => (
                <AgentCard key={agent.sessionId} agent={agent} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Resizable divider */}
      <div
        onMouseDown={onMouseDown}
        style={{
          height: 6,
          cursor: 'row-resize',
          background: 'var(--border-color)',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 32,
            height: 3,
            borderRadius: 2,
            background: 'var(--text-secondary)',
            opacity: 0.5,
          }}
        />
      </div>

      {/* Bottom panel: 3D field */}
      <div style={{ flex: 1, position: 'relative' }}>
        <BattlefieldScene>
          {battleAgents.map(agent => (
            <group key={agent.sessionId}>
              <AgentModel
                position={agent.position}
                color={agent.color}
                state={agent.state}
              />
              <ToolParticles
                position={[agent.position[0], agent.position[1] + 0.5, agent.position[2]]}
                color={agent.color}
                active={agent.state === 'active'}
              />
            </group>
          ))}
        </BattlefieldScene>
      </div>
    </div>
  );
}
