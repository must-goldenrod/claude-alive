import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
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
import { TILE_SIZE, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './engine/constants';
import { OrgChartOverlay } from './components/OrgChartOverlay';
import { AgentTimelinePanel } from './components/AgentTimelinePanel';
import type { PromptEntry } from './components/AgentTimelinePanel';

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
  const cameraTargetRef = useRef<{ x: number; y: number } | null>(null);
  const entitiesRef = useRef<Entity[]>(getEntities(officeRef.current));
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const promptsRef = useRef<PromptEntry[]>([]);
  const [, setPromptsVersion] = useState(0);
  const [, setCharVersion] = useState(0);

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
        const char = office.characters.get(msg.sessionId);
        if (char) char.direction = 'down';
        promptsRef.current = [...promptsRef.current, {
          sessionId: msg.sessionId,
          text: msg.prompt,
          timestamp: Date.now(),
        }];
        setPromptsVersion(v => v + 1);
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

  const handleAgentClick = useCallback((sessionId: string) => {
    const char = officeRef.current.characters.get(sessionId);
    if (!char) return;
    cameraTargetRef.current = {
      x: char.tileX * TILE_SIZE + TILE_SIZE / 2,
      y: char.tileY * TILE_SIZE + TILE_SIZE / 2,
    };
    setSelectedAgentId(prev => prev === sessionId ? null : sessionId);
  }, []);

  const handleZoom = useCallback((delta: number) => {
    const cur = cameraRef.current.zoom;
    cameraRef.current = {
      ...cameraRef.current,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur + delta)),
    };
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

      // Smooth camera lerp toward target
      const target = cameraTargetRef.current;
      if (target) {
        const lerpSpeed = 1 - Math.pow(0.001, dt); // ~8-10 frames to arrive
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

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    return () => { running = false; };
  }, []);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      <ProjectSidebar agents={agentList} characters={officeRef.current.characters} onRename={handleRename} onAgentClick={handleAgentClick} />

      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <Suspense fallback={null}>
          <PixelCanvas
            camera={cameraRef}
            tileMap={officeRef.current.tileMap}
            entities={entitiesRef}
          />
        </Suspense>

        {/* Zoom controls */}
        <div style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          {[
            { label: '+', delta: ZOOM_STEP },
            { label: '\u2212', delta: -ZOOM_STEP },
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

        {selectedAgentId && agents.get(selectedAgentId) && (
          <AgentTimelinePanel
            agent={agents.get(selectedAgentId)!}
            events={events}
            prompts={promptsRef.current}
            onClose={() => setSelectedAgentId(null)}
          />
        )}

        {!selectedAgentId && (
          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: 24,
              right: 24,
              zIndex: 10,
              pointerEvents: 'auto',
            }}
          >
            <NotificationBanner agents={agentList} />
          </div>
        )}
      </div>

      <RightPanel events={events} agents={agentList} completedSessions={completedSessions} />
    </div>
  );
}
