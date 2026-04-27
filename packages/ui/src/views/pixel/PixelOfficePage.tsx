import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import type { AgentInfo, AgentStats, CompletedSession, EventLogEntry, WSServerMessage } from '@claude-alive/core';
import type { SshSessionInfo } from '../chat/ChatOverlay.tsx';
import { ProjectSidebar } from '../unified/ProjectSidebar.tsx';
import { RightPanel } from '../unified/RightPanel.tsx';
import { getAnthropomorphicText } from '../../utils/bubbleText.ts';
import {
  createOfficeState, updateOffice, getEntities,
  spawnCharacter, despawnCharacter,
} from './engine/officeState';
import { startToolActivity, setCharacterIdle, hitTestCharacter } from './engine/character';
import type { Entity } from './engine/renderer';
import { TILE_SIZE, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './engine/constants';
import { OrgChartOverlay } from './components/OrgChartOverlay';
import type { RawMessageSubscribe } from '../../App.tsx';

const PixelCanvas = lazy(() => import('./components/PixelCanvas.tsx'));

function mapToolAnimation(animation: string | null): 'typing' | 'reading' {
  switch (animation) {
    case 'reading':
    case 'searching':
      return 'reading';
    default:
      return 'typing';
  }
}

interface PixelOfficePageProps {
  active: boolean;
  agents: Map<string, AgentInfo>;
  events: EventLogEntry[];
  completedSessions: CompletedSession[];
  stats: AgentStats | null;
  subscribeRaw: RawMessageSubscribe;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  sshSessions?: SshSessionInfo[];
  projectNames?: Record<string, string>;
  onProjectNameChange?: (cwd: string, name: string | null) => void;
}

export function PixelOfficePage({
  active,
  agents,
  events,
  completedSessions,
  stats,
  subscribeRaw,
  leftPanelOpen = true,
  rightPanelOpen = true,
  sshSessions,
  projectNames,
  onProjectNameChange,
}: PixelOfficePageProps) {
  const officeRef = useRef(createOfficeState());
  const cameraRef = useRef(officeRef.current.camera);
  const cameraTargetRef = useRef<{ x: number; y: number } | null>(null);
  const entitiesRef = useRef<Entity[]>(getEntities(officeRef.current));
  const [, setCharVersion] = useState(0);

  // Subscribe to raw WS messages to drive the pixel office state machine.
  // The handler is stable per mount; subscribeRaw is stable from App.
  useEffect(() => {
    const handler = (msg: WSServerMessage) => {
      const office = officeRef.current;

      switch (msg.type) {
        case 'snapshot': {
          for (const sid of office.characters.keys()) {
            if (!msg.agents.some(a => a.sessionId === sid)) {
              despawnCharacter(office, sid);
            }
          }
          for (const agent of msg.agents) {
            const char = spawnCharacter(office, agent.sessionId, {
              isSubAgent: !!agent.parentId,
              label: agent.displayName,
              project: agent.cwd,
            });
            char.bubbleText = getAnthropomorphicText(
              agent.state, agent.currentTool, agent.currentToolAnimation,
            );
            if (agent.state === 'active' && agent.currentToolAnimation) {
              startToolActivity(char, mapToolAnimation(agent.currentToolAnimation), office.tileMap);
            } else if (agent.state === 'waiting') {
              char.bubble = 'waiting';
            } else if (agent.state === 'error') {
              char.bubble = 'error';
            }
          }
          setCharVersion(v => v + 1);
          break;
        }
        case 'agent:spawn':
          spawnCharacter(office, msg.agent.sessionId, {
            isSubAgent: !!msg.agent.parentId,
            label: msg.agent.displayName,
            project: msg.agent.cwd,
          });
          setCharVersion(v => v + 1);
          break;
        case 'agent:despawn':
          despawnCharacter(office, msg.sessionId);
          setCharVersion(v => v + 1);
          break;
        case 'agent:state': {
          const char = office.characters.get(msg.sessionId);
          if (!char) break;
          switch (msg.state) {
            case 'active':
              startToolActivity(char, mapToolAnimation(msg.animation), office.tileMap);
              char.bubble = 'none';
              break;
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
              despawnCharacter(office, msg.sessionId);
              break;
          }
          char.bubbleText = getAnthropomorphicText(msg.state, msg.tool, msg.animation);
          break;
        }
        case 'agent:prompt': {
          // Face the character toward the user when a prompt arrives.
          const char = office.characters.get(msg.sessionId);
          if (char) char.direction = 'down';
          break;
        }
        case 'agent:rename': {
          const char = office.characters.get(msg.sessionId);
          if (char) {
            char.label = msg.name;
          }
          break;
        }
      }
    };
    const unsubscribe = subscribeRaw(handler);
    return unsubscribe;
  }, [subscribeRaw]);

  const agentList = useMemo(() => Array.from(agents.values()), [agents]);
  const projectPaths = useMemo(() => [...new Set(agentList.map(a => a.cwd))], [agentList]);

  const handleAgentClick = useCallback((sessionId: string) => {
    const char = officeRef.current.characters.get(sessionId);
    if (!char) return;
    cameraTargetRef.current = {
      x: char.tileX * TILE_SIZE + TILE_SIZE / 2,
      y: char.tileY * TILE_SIZE + TILE_SIZE / 2,
    };
    // Also focus the corresponding terminal tab (no-op if none matches).
    window.dispatchEvent(
      new CustomEvent('terminal:focusTab', { detail: { sessionId } }),
    );
  }, []);

  const handleWorldClick = useCallback((worldX: number, worldY: number) => {
    for (const char of officeRef.current.characters.values()) {
      if (hitTestCharacter(char, worldX, worldY)) {
        handleAgentClick(char.sessionId);
        return;
      }
    }
    cameraTargetRef.current = null;
  }, [handleAgentClick]);

  const handlePan = useCallback(() => {
    cameraTargetRef.current = null;
  }, []);

  const handleZoom = useCallback((delta: number) => {
    const cur = cameraRef.current.zoom;
    cameraRef.current = {
      ...cameraRef.current,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur + delta)),
    };
  }, []);

  // Game loop: paused when view is inactive to save CPU.
  // Using a ref so toggling `active` doesn't restart the RAF chain — just gates the tick body.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let running = true;
    let lastTime = performance.now();

    function tick() {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (activeRef.current) {
        const office = officeRef.current;
        updateOffice(office, dt);
        entitiesRef.current = getEntities(office);

        const target = cameraTargetRef.current;
        if (target) {
          const lerpSpeed = 1 - Math.pow(0.001, dt);
          const cam = cameraRef.current;
          const dx = target.x - cam.x;
          const dy = target.y - cam.y;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
            cameraRef.current = { ...cam, x: target.x, y: target.y };
            cameraTargetRef.current = null;
          } else {
            cameraRef.current = { ...cam, x: cam.x + dx * lerpSpeed, y: cam.y + dy * lerpSpeed };
          }
        }

        office.camera = cameraRef.current;
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    return () => { running = false; };
  }, []);

  // Unused props kept for interface parity with App; referenced here to silence unused warnings.
  void projectPaths;

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      <ProjectSidebar
        agents={agentList}
        characters={officeRef.current.characters}
        onAgentClick={handleAgentClick}
        collapsed={!leftPanelOpen}
        sshSessions={sshSessions}
        projectNames={projectNames}
        onProjectNameChange={onProjectNameChange}
      />

      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <Suspense fallback={null}>
          <PixelCanvas
            camera={cameraRef}
            tileMap={officeRef.current.tileMap}
            entities={entitiesRef}
            onWorldClick={handleWorldClick}
            onPan={handlePan}
          />
        </Suspense>

        {/* Zoom controls */}
        <div style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          {[
            { label: '+', delta: ZOOM_STEP },
            { label: '−', delta: -ZOOM_STEP },
          ].map(({ label, delta }) => (
            <button
              key={label}
              onClick={() => handleZoom(delta)}
              style={{
                width: 36,
                height: 36,
                background: 'rgba(22, 27, 34, 0.85)',
                border: '1px solid var(--border-color)',
                borderRadius: 10,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1,
                transition: 'all 0.2s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <OrgChartOverlay
          agents={agentList}
          characters={officeRef.current.characters}
          camera={cameraRef}
        />

      </div>

      <RightPanel events={events} agents={agentList} completedSessions={completedSessions} stats={stats} collapsed={!rightPanelOpen} />
    </div>
  );
}
