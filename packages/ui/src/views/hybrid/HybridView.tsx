import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { AgentInfo, AgentState, ToolAnimation, EventLogEntry, WSServerMessage } from '@claude-alive/core';
import { StatsBar } from '../dashboard/components/StatsBar.tsx';
import { AgentCard } from '../dashboard/components/AgentCard.tsx';
import PixelCanvas from '../pixel/components/PixelCanvas.tsx';
import { createOfficeState, updateOffice, getEntities, spawnCharacter, despawnCharacter } from '../pixel/engine/officeState.ts';
import { startToolActivity, setCharacterIdle } from '../pixel/engine/character.ts';
import type { Entity } from '../pixel/engine/renderer.ts';

// ── Shared WebSocket for both panels ─────────────────────────────────────

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function mapToolAnimation(animation: string | null): 'typing' | 'reading' {
  switch (animation) {
    case 'reading':
    case 'searching':
      return 'reading';
    case 'typing':
    case 'running':
    case 'thinking':
    default:
      return 'typing';
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

const officeState = createOfficeState();

export function HybridView() {
  const wsUrl = useMemo(getWsUrl, []);

  // Dashboard state
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  // Pixel state
  const camera = useRef(officeState.camera);
  const entities = useRef<Entity[]>(getEntities(officeState));

  // WebSocket: single connection that feeds both panels
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

      // Feed dashboard state
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

      // Feed pixel state
      switch (msg.type) {
        case 'snapshot': {
          for (const agent of msg.agents) {
            if (!officeState.characters.has(agent.sessionId)) {
              const char = spawnCharacter(officeState, agent.sessionId);
              if (agent.state === 'active' && agent.currentToolAnimation) {
                startToolActivity(char, mapToolAnimation(agent.currentToolAnimation), officeState.tileMap);
              } else if (agent.state === 'waiting') {
                char.bubble = 'waiting';
              } else if (agent.state === 'error') {
                char.bubble = 'error';
              }
            }
          }
          break;
        }
        case 'agent:spawn':
          spawnCharacter(officeState, msg.agent.sessionId);
          break;
        case 'agent:despawn':
          despawnCharacter(officeState, msg.sessionId);
          break;
        case 'agent:state': {
          const char = officeState.characters.get(msg.sessionId);
          if (!char) break;
          switch (msg.state) {
            case 'active': {
              const anim = mapToolAnimation(msg.animation);
              startToolActivity(char, anim, officeState.tileMap);
              char.bubble = 'none';
              break;
            }
            case 'idle':
            case 'done':
              setCharacterIdle(char);
              break;
            case 'listening':
              setCharacterIdle(char);
              char.direction = 'down';
              break;
            case 'waiting':
              char.bubble = 'waiting';
              break;
            case 'error':
              char.bubble = 'error';
              break;
            case 'despawning':
              despawnCharacter(officeState, msg.sessionId);
              break;
          }
          break;
        }
        case 'agent:prompt': {
          const char = officeState.characters.get(msg.sessionId);
          if (char) char.direction = 'down';
          break;
        }
      }
    };
  }, [wsUrl]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Pixel game loop
  useEffect(() => {
    const originalCamera = officeState.camera;
    let running = true;
    let lastTime = performance.now();

    function tick() {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      updateOffice(officeState, dt);
      entities.current = getEntities(officeState);
      officeState.camera = camera.current;

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    return () => {
      running = false;
      officeState.camera = originalCamera;
    };
  }, []);

  const { ratio, onMouseDown } = useDivider(0.4);
  const agentList = Array.from(agents.values());

  const handleTileClick = useCallback((col: number, row: number) => {
    console.log(`Tile clicked: (${col}, ${row})`);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top panel: mini dashboard */}
      <div
        style={{
          height: `${ratio * 100}%`,
          overflow: 'auto',
          background: 'var(--bg-primary)',
        }}
      >
        <div className="p-4 space-y-4 max-w-7xl mx-auto w-full">
          {/* Connection indicator */}
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
                boxShadow: connected ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-red)',
              }}
            />
            <span>{connected ? 'connected' : 'disconnected'}</span>
            <span style={{ marginLeft: 'auto' }}>{agentList.length} agent{agentList.length !== 1 ? 's' : ''}</span>
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

      {/* Bottom panel: pixel office */}
      <div style={{ flex: 1, position: 'relative' }}>
        <PixelCanvas
          camera={camera}
          tileMap={officeState.tileMap}
          entities={entities}
          onTileClick={handleTileClick}
        />
      </div>
    </div>
  );
}
