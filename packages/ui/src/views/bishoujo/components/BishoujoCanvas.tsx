import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Application, extend } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import type { AgentInfo } from '@claude-alive/core';
import { Live2DCharacter } from './Live2DCharacter.tsx';
import { SceneBackground } from './SceneBackground.tsx';
import { UIOverlay } from './UIOverlay.tsx';
import { SpawnEffect } from './SpawnEffect.tsx';
import { assignSlots } from '../engine/sceneLayout.ts';
import {
  createInteractionState,
  updateTracking,
  type InteractionState,
} from '../engine/interactionHandler.ts';
import { DEFAULT_ZOOM } from '../engine/constants.ts';

// Register PixiJS components for JSX
extend({ Container, Graphics });

interface BishoujoCanvasProps {
  agents: AgentInfo[];
}

/**
 * The main PixiJS + Live2D canvas for the Bishoujo view.
 * Manages the scene, characters, interaction, and overlay.
 */
export function BishoujoCanvas({ agents }: BishoujoCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const interaction = useRef<InteractionState>(createInteractionState());
  const [zoom] = useState(DEFAULT_ZOOM);
  const [spawningSessions, setSpawningSessions] = useState<Set<string>>(new Set());

  // Track canvas size
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      if (entry) {
        const { width, height } = entry.contentRect;
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute slot assignments (stable across re-renders for same agent set)
  const sessionIds = useMemo(
    () => agents.map(a => a.sessionId),
    // Re-compute when session set changes (not on every state change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents.map(a => a.sessionId).join(',')],
  );
  const slotMap = useMemo(() => assignSlots(sessionIds), [sessionIds]);

  // Track spawning sessions for particle effects
  const prevSessionsRef = useRef(new Set<string>());
  useEffect(() => {
    const current = new Set(sessionIds);
    const newSessions = new Set<string>();
    for (const id of current) {
      if (!prevSessionsRef.current.has(id)) {
        newSessions.add(id);
      }
    }
    if (newSessions.size > 0) {
      setSpawningSessions(prev => new Set([...prev, ...newSessions]));
      // Clear spawn effects after animation
      const timer = setTimeout(() => {
        setSpawningSessions(prev => {
          const next = new Set(prev);
          for (const id of newSessions) next.delete(id);
          return next;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
    prevSessionsRef.current = current;
  }, [sessionIds]);

  // Mouse tracking
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Normalise to -1..1
      interaction.current.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      interaction.current.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      updateTracking(interaction.current, 0.016);
    },
    [],
  );

  const handleCharacterLoaded = useCallback((_sessionId: string) => {
    // Could trigger additional effects here
  }, []);

  return (
    <div
      ref={wrapperRef}
      onMouseMove={handleMouseMove}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#1a1a2e',
      }}
    >
      {size.width > 0 && size.height > 0 && (
        <Application
          width={size.width}
          height={size.height}
          backgroundColor={0x1a1a2e}
          antialias
          autoDensity
          resolution={window.devicePixelRatio || 1}
        >
          <SceneBackground />

          <pixiContainer
            sortableChildren
            scale={zoom}
            position={{ x: 0, y: 0 }}
          >
            {agents.map(agent => {
              const slot = slotMap.get(agent.sessionId);
              if (!slot) return null;
              const px = slot.def.x * size.width / zoom;
              const py = slot.def.y * size.height / zoom;

              return (
                <Live2DCharacter
                  key={agent.sessionId}
                  sessionId={agent.sessionId}
                  modelName={slot.modelName}
                  x={px}
                  y={py}
                  scale={slot.def.scale}
                  zIndex={slot.def.z}
                  state={agent.state}
                  animation={agent.currentToolAnimation}
                  interaction={interaction.current}
                  onLoaded={handleCharacterLoaded}
                />
              );
            })}

            {/* Spawn particle effects */}
            {agents.map(agent => {
              const slot = slotMap.get(agent.sessionId);
              if (!slot || !spawningSessions.has(agent.sessionId)) return null;
              const px = slot.def.x * size.width / zoom;
              const py = slot.def.y * size.height / zoom;
              return (
                <SpawnEffect
                  key={`spawn-${agent.sessionId}`}
                  x={px}
                  y={py - 50}
                  active={spawningSessions.has(agent.sessionId)}
                />
              );
            })}
          </pixiContainer>
        </Application>
      )}

      {/* DOM overlay for names, bubbles, status */}
      <UIOverlay
        agents={agents}
        slotMap={slotMap}
        canvasWidth={size.width}
        canvasHeight={size.height}
      />
    </div>
  );
}
