import type { TileMap } from './tilemap';
import type { Camera } from './camera';
import {
  TILE_SIZE,
  FLOOR_COLOR,
  WALL_COLOR,
  GRID_LINE_COLOR,
  VOID_COLOR,
  DESK_COLOR,
  DESK_TOP_COLOR,
  DESK_EDGE_COLOR,
  MONITOR_COLOR,
  MONITOR_SCREEN_COLOR,
  MONITOR_SCREEN_GLOW,
  KEYBOARD_COLOR,
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

function drawDeskTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Desk body
  ctx.fillStyle = DESK_COLOR;
  ctx.fillRect(sx, sy, size, size);
  // Top surface highlight
  ctx.fillStyle = DESK_TOP_COLOR;
  ctx.fillRect(sx + 1, sy + 1, size - 2, Math.max(2, size * 0.2));
  // Bottom edge shadow
  ctx.fillStyle = DESK_EDGE_COLOR;
  ctx.fillRect(sx, sy + size - Math.max(1, size * 0.1), size, Math.max(1, size * 0.1));
}

function drawComputerTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Draw desk first
  drawDeskTile(ctx, sx, sy, size);

  const pad = Math.max(2, size * 0.15);
  const monW = size * 0.6;
  const monH = size * 0.45;
  const monX = sx + (size - monW) / 2;
  const monY = sy + pad;

  // Monitor body
  ctx.fillStyle = MONITOR_COLOR;
  ctx.fillRect(monX, monY, monW, monH);
  // Monitor screen
  ctx.fillStyle = MONITOR_SCREEN_COLOR;
  ctx.fillRect(monX + 2, monY + 2, monW - 4, monH - 4);
  // Screen glow line
  ctx.fillStyle = MONITOR_SCREEN_GLOW;
  ctx.fillRect(monX + 3, monY + 3, monW - 6, 1);

  // Monitor stand
  const standW = size * 0.12;
  const standX = sx + (size - standW) / 2;
  ctx.fillStyle = MONITOR_COLOR;
  ctx.fillRect(standX, monY + monH, standW, size * 0.1);

  // Keyboard
  const kbW = size * 0.5;
  const kbH = size * 0.15;
  const kbX = sx + (size - kbW) / 2;
  const kbY = sy + size - pad - kbH;
  ctx.fillStyle = KEYBOARD_COLOR;
  ctx.fillRect(kbX, kbY, kbW, kbH);
  // Keyboard keys
  ctx.fillStyle = '#444458';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(kbX + 2 + i * (kbW / 3), kbY + 1, kbW / 3 - 3, kbH - 3);
  }
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

  // 1. Clear canvas
  ctx.fillStyle = VOID_COLOR;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  // 2. Viewport offset
  const offsetX = Math.floor(w / 2 - camera.x * zoom);
  const offsetY = Math.floor(h / 2 - camera.y * zoom);

  // 3. Visible tile range
  const startCol = Math.max(0, Math.floor(-offsetX / (TILE_SIZE * zoom)));
  const startRow = Math.max(0, Math.floor(-offsetY / (TILE_SIZE * zoom)));
  const endCol = Math.min(tileMap.cols, Math.ceil((w - offsetX) / (TILE_SIZE * zoom)));
  const endRow = Math.min(tileMap.rows, Math.ceil((h - offsetY) / (TILE_SIZE * zoom)));

  // 4. Render tiles
  const tileScreenSize = TILE_SIZE * zoom;

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const tile = tileMap.tiles[r * tileMap.cols + c];
      const sx = Math.floor(c * TILE_SIZE * zoom + offsetX);
      const sy = Math.floor(r * TILE_SIZE * zoom + offsetY);

      switch (tile) {
        case TileType.FLOOR:
          ctx.fillStyle = FLOOR_COLOR;
          ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
          break;
        case TileType.WALL:
          ctx.fillStyle = WALL_COLOR;
          ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
          ctx.fillStyle = '#252535';
          ctx.fillRect(sx, sy, tileScreenSize, Math.max(1, zoom));
          ctx.fillRect(sx, sy, Math.max(1, zoom), tileScreenSize);
          break;
        case TileType.DESK:
          drawDeskTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.COMPUTER:
          drawComputerTile(ctx, sx, sy, tileScreenSize);
          break;
        // VOID: already cleared
      }
    }
  }

  // 5. Grid overlay (subtle)
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

  // 6. Z-sort entities by Y
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
