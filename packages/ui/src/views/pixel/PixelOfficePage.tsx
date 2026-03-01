import { useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import type { WSServerMessage } from '@claude-alive/core';
import { useWebSocket } from '../dashboard/hooks/useWebSocket.ts';
import { ProjectSidebar } from '../unified/ProjectSidebar.tsx';
import { RightPanel } from '../unified/RightPanel.tsx';
import { NotificationBanner } from '../dashboard/components/NotificationBanner.tsx';
import { getAnthropomorphicText } from '../../utils/bubbleText.ts';
import {
  createOfficeState, updateOffice, getEntities,
  spawnCharacter, despawnCharacter,
} from './engine/officeState';
import { startToolActivity, setCharacterIdle } from './engine/character';
import type { Entity } from './engine/renderer';
import { OrgChartOverlay } from './components/OrgChartOverlay';

const PixelCanvas = lazy(() => import('./components/PixelCanvas.tsx'));

const WS_URL = `ws://${window.location.hostname}:${window.location.port || '3141'}/ws`;
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

function mapToolAnimation(animation: string | null): 'typing' | 'reading' {
  switch (animation) {
    case 'reading':
    case 'searching':
      return 'reading';
    default:
      return 'typing';
  }
}

export function PixelOfficePage() {
  const officeRef = useRef(createOfficeState());
  const cameraRef = useRef(officeRef.current.camera);
  const entitiesRef = useRef<Entity[]>(getEntities(officeRef.current));

  // Stable callback ref for onRawMessage (avoids useWebSocket reconnects)
  const onRawRef = useRef<(msg: WSServerMessage) => void>(() => {});

  onRawRef.current = (msg: WSServerMessage) => {
    const office = officeRef.current;

    switch (msg.type) {
      case 'snapshot': {
        // Remove stale characters
        for (const sid of office.characters.keys()) {
          if (!msg.agents.some(a => a.sessionId === sid)) {
            despawnCharacter(office, sid);
          }
        }
        // Spawn/sync all agents
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
        break;
      }
      case 'agent:spawn':
        spawnCharacter(office, msg.agent.sessionId, {
          isSubAgent: !!msg.agent.parentId,
          label: msg.agent.displayName,
          project: msg.agent.cwd,
        });
        break;
      case 'agent:despawn':
        despawnCharacter(office, msg.sessionId);
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
        const char = office.characters.get(msg.sessionId);
        if (char) char.direction = 'down';
        break;
      }
    }
  };

  const stableOnRaw = useCallback((msg: WSServerMessage) => onRawRef.current(msg), []);

  const { agents, events, completedSessions } = useWebSocket(WS_URL, stableOnRaw);
  const agentList = Array.from(agents.values());

  const handleRename = useCallback((sessionId: string, name: string | null) => {
    fetch(`${API_BASE}/api/agents/${sessionId}/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }, []);

  // Game loop: 60fps update cycle
  useEffect(() => {
    let running = true;
    let lastTime = performance.now();

    function tick() {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const office = officeRef.current;
      updateOffice(office, dt);
      entitiesRef.current = getEntities(office);
      office.camera = cameraRef.current;

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    return () => { running = false; };
  }, []);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      <ProjectSidebar agents={agentList} onRename={handleRename} />

      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <Suspense fallback={null}>
          <PixelCanvas
            camera={cameraRef}
            tileMap={officeRef.current.tileMap}
            entities={entitiesRef}
          />
        </Suspense>

        <OrgChartOverlay
          agents={agentList}
          characters={officeRef.current.characters}
          camera={cameraRef}
        />

        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 20,
            right: 20,
            zIndex: 10,
            pointerEvents: 'auto',
          }}
        >
          <NotificationBanner agents={agentList} />
        </div>
      </div>

      <RightPanel events={events} agents={agentList} completedSessions={completedSessions} />
    </div>
  );
}
