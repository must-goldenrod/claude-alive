import { useRef, useCallback, useEffect, useMemo } from 'react';
import PixelCanvas from './components/PixelCanvas';
import StatusOverlay from './components/StatusOverlay';
import { createOfficeState, updateOffice, getEntities } from './engine/officeState';
import { useOfficeWebSocket } from './hooks/useOfficeWebSocket';
import type { Entity } from './engine/renderer';

// Derive WebSocket URL from current page location (same pattern as dashboard)
function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const officeState = createOfficeState();

export default function App() {
  const camera = useRef(officeState.camera);
  const entities = useRef<Entity[]>(getEntities(officeState));
  const wsUrl = useMemo(getWsUrl, []);
  const wsStatus = useOfficeWebSocket(wsUrl, officeState);

  // Game loop: update office state and sync entities each frame
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

      // Sync camera from ref back to state (user may have panned/zoomed)
      officeState.camera = camera.current;

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);

    return () => {
      running = false;
      officeState.camera = originalCamera;
    };
  }, []);

  const handleTileClick = useCallback((col: number, row: number) => {
    console.log(`Tile clicked: (${col}, ${row})`);
  }, []);

  return (
    <>
      <PixelCanvas
        camera={camera}
        tileMap={officeState.tileMap}
        entities={entities}
        onTileClick={handleTileClick}
      />
      <StatusOverlay
        connected={wsStatus.connected}
        agentCount={wsStatus.agentCount}
        url={wsStatus.url}
      />
    </>
  );
}
