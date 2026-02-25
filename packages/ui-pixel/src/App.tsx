import { useRef, useCallback, useEffect } from 'react';
import PixelCanvas from './components/PixelCanvas';
import { createOfficeState, spawnCharacter, updateOffice, getEntities } from './engine/officeState';
import type { OfficeState } from './engine/officeState';
import type { Entity } from './engine/renderer';

const officeState: OfficeState = createOfficeState();

// Spawn 3 test characters
spawnCharacter(officeState, 'test-agent-1');
spawnCharacter(officeState, 'test-agent-2');
spawnCharacter(officeState, 'test-agent-3');

export default function App() {
  const camera = useRef(officeState.camera);
  const entities = useRef<Entity[]>(getEntities(officeState));

  // Sync camera ref back to state and update entities each frame via the game loop update
  useEffect(() => {
    const originalCamera = officeState.camera;
    // The PixelCanvas game loop calls update -> render each frame.
    // We hook into it by keeping entities.current fresh.
    // The update callback is passed to PixelCanvas via a ref pattern:
    // we update office state and entity list from a rAF-driven interval.
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
    <PixelCanvas
      camera={camera}
      tileMap={officeState.tileMap}
      entities={entities}
      onTileClick={handleTileClick}
    />
  );
}
