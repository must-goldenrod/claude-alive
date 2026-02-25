import type { TileMap } from './tilemap';
import type { Camera } from './camera';
import {
  TILE_SIZE,
  FLOOR_COLOR,
  WALL_COLOR,
  GRID_LINE_COLOR,
  VOID_COLOR,
} from './constants';
import { TileType } from './tilemap';

/** Renderable entity interface */
export interface Entity {
  x: number; // world pixel X (left edge)
  y: number; // world pixel Y (bottom of sprite)
  width: number;
  height: number;
  render: (ctx: CanvasRenderingContext2D, zoom: number) => void;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
  tileMap: TileMap,
  entities: Entity[],
): void {
  const w = width;
  const h = height;
  const zoom = camera.zoom;

  // 1. Clear canvas with void color
  ctx.fillStyle = VOID_COLOR;
  ctx.fillRect(0, 0, w, h);

  // Disable smoothing for pixel-perfect rendering
  ctx.imageSmoothingEnabled = false;

  // 2. Calculate viewport offset: screen center maps to camera position
  const offsetX = Math.floor(w / 2 - camera.x * zoom);
  const offsetY = Math.floor(h / 2 - camera.y * zoom);

  // 3. Calculate visible tile range
  const startCol = Math.max(0, Math.floor(-offsetX / (TILE_SIZE * zoom)));
  const startRow = Math.max(0, Math.floor(-offsetY / (TILE_SIZE * zoom)));
  const endCol = Math.min(
    tileMap.cols,
    Math.ceil((w - offsetX) / (TILE_SIZE * zoom)),
  );
  const endRow = Math.min(
    tileMap.rows,
    Math.ceil((h - offsetY) / (TILE_SIZE * zoom)),
  );

  // 4. Render tiles
  const tileScreenSize = TILE_SIZE * zoom;

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const tile = tileMap.tiles[r * tileMap.cols + c];
      const sx = Math.floor(c * TILE_SIZE * zoom + offsetX);
      const sy = Math.floor(r * TILE_SIZE * zoom + offsetY);

      if (tile === TileType.FLOOR) {
        ctx.fillStyle = FLOOR_COLOR;
        ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
      } else if (tile === TileType.WALL) {
        // Wall body
        ctx.fillStyle = WALL_COLOR;
        ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
        // 3D top-edge highlight
        ctx.fillStyle = '#252535';
        ctx.fillRect(sx, sy, tileScreenSize, Math.max(1, zoom));
        // 3D left-edge highlight
        ctx.fillRect(sx, sy, Math.max(1, zoom), tileScreenSize);
      }
      // VOID tiles are already cleared by background fill
    }
  }

  // 5. Grid overlay
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;
  for (let r = startRow; r <= endRow; r++) {
    const sy = Math.floor(r * TILE_SIZE * zoom + offsetY) + 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.floor(startCol * TILE_SIZE * zoom + offsetX), sy);
    ctx.lineTo(Math.floor(endCol * TILE_SIZE * zoom + offsetX), sy);
    ctx.stroke();
  }
  for (let c = startCol; c <= endCol; c++) {
    const sx = Math.floor(c * TILE_SIZE * zoom + offsetX) + 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, Math.floor(startRow * TILE_SIZE * zoom + offsetY));
    ctx.lineTo(sx, Math.floor(endRow * TILE_SIZE * zoom + offsetY));
    ctx.stroke();
  }

  // 6. Z-sort entities by Y position (bottom of sprite)
  const sorted = [...entities].sort((a, b) => a.y - b.y);

  // 7. Render entities
  ctx.save();
  ctx.translate(offsetX, offsetY);
  for (const entity of sorted) {
    ctx.save();
    ctx.translate(
      Math.floor(entity.x * zoom),
      Math.floor((entity.y - entity.height) * zoom),
    );
    entity.render(ctx, zoom);
    ctx.restore();
  }
  ctx.restore();
}
