import { useRef, useCallback, useEffect, useMemo } from 'react';
import PixelCanvas from './components/PixelCanvas.tsx';
import StatusOverlay from './components/StatusOverlay.tsx';
import { createOfficeState, updateOffice, getEntities } from './engine/officeState.ts';
import { useOfficeWebSocket } from './hooks/useOfficeWebSocket.ts';
import type { Entity } from './engine/renderer.ts';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const officeState = createOfficeState();

export function PixelView() {
  const camera = useRef(officeState.camera);
  const entities = useRef<Entity[]>(getEntities(officeState));
  const wsUrl = useMemo(getWsUrl, []);
  const wsStatus = useOfficeWebSocket(wsUrl, officeState);

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

  const handleTileClick = useCallback((col: number, row: number) => {
    console.log(`Tile clicked: (${col}, ${row})`);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
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
    </div>
  );
}
