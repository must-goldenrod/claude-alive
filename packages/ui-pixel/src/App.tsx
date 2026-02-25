import { useRef, useCallback } from 'react';
import PixelCanvas from './components/PixelCanvas';
import { createDefaultOffice } from './engine/tilemap';
import { createCamera } from './engine/camera';
import { TILE_SIZE, CHAR_WIDTH, CHAR_HEIGHT } from './engine/constants';
import type { Camera } from './engine/camera';
import type { Entity } from './engine/renderer';

// Create test entities: colored rectangles to verify z-sort
function makeTestEntity(
  col: number,
  row: number,
  color: string,
  label: string,
): Entity {
  return {
    x: col * TILE_SIZE,
    y: (row + 1) * TILE_SIZE, // bottom of sprite at bottom of tile
    width: CHAR_WIDTH,
    height: CHAR_HEIGHT,
    render(ctx: CanvasRenderingContext2D, zoom: number) {
      const w = CHAR_WIDTH * zoom;
      const h = CHAR_HEIGHT * zoom;
      // Body
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      // Outline
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, w, h);
      // Label
      ctx.fillStyle = '#fff';
      const fontSize = Math.max(8, 4 * zoom);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2);
    },
  };
}

const tileMap = createDefaultOffice();

export default function App() {
  const camera = useRef<Camera>(createCamera());

  // Test entities at different Y positions to verify z-sort
  const entities = useRef<Entity[]>([
    makeTestEntity(5, 2, '#7c4dff', 'A'), // top row
    makeTestEntity(6, 5, '#00c853', 'B'), // middle row
    makeTestEntity(7, 4, '#448aff', 'C'), // between A and B
    makeTestEntity(14, 8, '#ffab00', 'D'), // bottom area
  ]);

  const handleTileClick = useCallback((col: number, row: number) => {
    console.log(`Tile clicked: (${col}, ${row})`);
  }, []);

  return (
    <PixelCanvas
      camera={camera}
      tileMap={tileMap}
      entities={entities}
      onTileClick={handleTileClick}
    />
  );
}
