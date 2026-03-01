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
  CHAIR_SEAT_COLOR,
  CHAIR_BACK_COLOR,
  PLANT_POT_COLOR,
  PLANT_LEAF_COLOR,
  PLANT_LEAF_DARK,
  SOFA_COLOR,
  SOFA_CUSHION,
  BOOKSHELF_WOOD,
  BOOKSHELF_BACK,
  COFFEE_BODY,
  COFFEE_ACCENT,
  WHITEBOARD_COLOR,
  WHITEBOARD_FRAME,
  MEETING_TABLE_COLOR,
  MEETING_TABLE_TOP,
  SNACK_BODY,
  SNACK_GLASS,
  RUG_COLOR,
  RUG_PATTERN,
  POSTER_BG,
  CLOCK_FACE,
  CLOCK_FRAME,
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

function drawChairTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Back rest
  ctx.fillStyle = CHAIR_BACK_COLOR;
  ctx.fillRect(sx, sy + size * 0.15, size, size * 0.2);
  // Seat
  const seatW = size * 0.6;
  const seatX = sx + (size - seatW) / 2;
  const seatY = sy + size * 0.4;
  const seatH = size * 0.3;
  ctx.fillStyle = CHAIR_SEAT_COLOR;
  ctx.fillRect(seatX, seatY, seatW, seatH);
  // Highlight on seat top
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(seatX, seatY, seatW, Math.max(1, 1));
}

function drawPlantTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Pot
  const potW = size * 0.4;
  const potH = size * 0.35;
  const potX = sx + (size - potW) / 2;
  const potY = sy + size - potH;
  ctx.fillStyle = PLANT_POT_COLOR;
  ctx.fillRect(potX, potY, potW, potH);
  // Pot rim
  const rimW = potW + 4;
  ctx.fillRect(sx + (size - rimW) / 2, potY, rimW, Math.max(2, size * 0.06));
  // Leaves
  const leafBase = potY - 2;
  const cx = sx + size / 2;
  ctx.fillStyle = PLANT_LEAF_COLOR;
  ctx.fillRect(cx - size * 0.15, leafBase - size * 0.3, size * 0.3, size * 0.3);
  ctx.fillRect(cx - size * 0.25, leafBase - size * 0.2, size * 0.2, size * 0.2);
  ctx.fillStyle = PLANT_LEAF_DARK;
  ctx.fillRect(cx + size * 0.05, leafBase - size * 0.25, size * 0.2, size * 0.2);
  ctx.fillStyle = PLANT_LEAF_COLOR;
  ctx.fillRect(cx - size * 0.1, leafBase - size * 0.4, size * 0.15, size * 0.15);
}

function drawBookshelfTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Frame
  ctx.fillStyle = BOOKSHELF_WOOD;
  ctx.fillRect(sx, sy, size, size);
  // Back panel
  ctx.fillStyle = BOOKSHELF_BACK;
  ctx.fillRect(sx + 2, sy + 2, size - 4, size - 4);
  // Shelf rows
  const bookColors = ['#C0392B', '#2980B9', '#27AE60', '#F39C12', '#8E44AD'];
  const shelfH = Math.floor((size - 6) / 3);
  for (let row = 0; row < 3; row++) {
    const shelfY = sy + 2 + row * shelfH;
    // Shelf plank
    ctx.fillStyle = BOOKSHELF_WOOD;
    ctx.fillRect(sx + 2, shelfY + shelfH - 2, size - 4, 2);
    // Books
    const bookW = Math.max(2, Math.floor((size - 8) / 4));
    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = bookColors[(row * 4 + b) % bookColors.length];
      const bx = sx + 3 + b * (bookW + 1);
      const bh = shelfH - 4;
      ctx.fillRect(bx, shelfY + 1, bookW, bh);
    }
  }
}

function drawSofaTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  const sofaW = size * 0.8;
  const sofaX = sx + (size - sofaW) / 2;
  // Back
  ctx.fillStyle = SOFA_COLOR;
  ctx.fillRect(sofaX, sy + size * 0.15, sofaW, size * 0.25);
  // Seat cushion
  ctx.fillStyle = SOFA_CUSHION;
  ctx.fillRect(sofaX, sy + size * 0.4, sofaW, size * 0.4);
  // Highlight on cushion
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(sofaX, sy + size * 0.4, sofaW, Math.max(1, 1));
  // Armrest left
  ctx.fillStyle = SOFA_COLOR;
  ctx.fillRect(sofaX - 2, sy + size * 0.3, 4, size * 0.5);
}

function drawCoffeeMachineTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  const bodyW = size * 0.6;
  const bodyH = size * 0.7;
  const bodyX = sx + (size - bodyW) / 2;
  const bodyY = sy + (size - bodyH) / 2;
  // Base (slightly wider)
  ctx.fillStyle = COFFEE_BODY;
  ctx.fillRect(bodyX - 2, bodyY + bodyH - 4, bodyW + 4, 4);
  // Body
  ctx.fillStyle = COFFEE_BODY;
  ctx.fillRect(bodyX, bodyY, bodyW, bodyH);
  // Water tank top
  ctx.fillStyle = '#4A4A5E';
  ctx.fillRect(bodyX + 2, bodyY + 2, bodyW - 4, bodyH * 0.3);
  // Accent button
  ctx.fillStyle = COFFEE_ACCENT;
  ctx.fillRect(bodyX + bodyW - 6, bodyY + bodyH * 0.4, 4, 3);
  // Cup area (indentation)
  ctx.fillStyle = '#2C2C3E';
  ctx.fillRect(bodyX + 4, bodyY + bodyH - 10, bodyW - 8, 6);
}

function drawWhiteboardTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Frame
  ctx.fillStyle = WHITEBOARD_FRAME;
  ctx.fillRect(sx + 2, sy + 2, size - 4, size - 4);
  // White surface
  ctx.fillStyle = WHITEBOARD_COLOR;
  ctx.fillRect(sx + 4, sy + 4, size - 8, size - 10);
  // Marker tray
  ctx.fillStyle = WHITEBOARD_FRAME;
  ctx.fillRect(sx + 4, sy + size - 8, size - 8, 3);
  // Dots on board (writing marks)
  ctx.fillStyle = '#3498DB';
  ctx.fillRect(sx + 8, sy + 8, 3, 2);
  ctx.fillStyle = '#E74C3C';
  ctx.fillRect(sx + 14, sy + 12, 4, 2);
  ctx.fillStyle = '#2ECC71';
  ctx.fillRect(sx + 10, sy + 16, 3, 2);
}

function drawMeetingTableTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Table surface
  ctx.fillStyle = MEETING_TABLE_COLOR;
  ctx.fillRect(sx, sy, size, size);
  // Top highlight
  ctx.fillStyle = MEETING_TABLE_TOP;
  ctx.fillRect(sx, sy, size, Math.max(1, size * 0.06));
  // Bottom edge shadow
  ctx.fillStyle = '#3A5B7A';
  ctx.fillRect(sx, sy + size - Math.max(1, size * 0.06), size, Math.max(1, size * 0.06));
}

function drawSnackMachineTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  const bodyW = size * 0.65;
  const bodyH = size * 0.8;
  const bodyX = sx + (size - bodyW) / 2;
  const bodyY = sy + (size - bodyH) / 2;
  // Body
  ctx.fillStyle = SNACK_BODY;
  ctx.fillRect(bodyX, bodyY, bodyW, bodyH);
  // Glass front
  const glassW = bodyW * 0.65;
  const glassH = bodyH * 0.6;
  const glassX = bodyX + (bodyW - glassW) / 2;
  const glassY = bodyY + 4;
  ctx.fillStyle = SNACK_GLASS;
  ctx.fillRect(glassX, glassY, glassW, glassH);
  // Snack items inside glass
  const itemW = Math.max(2, glassW * 0.6);
  const itemH = Math.max(2, glassH / 4);
  ctx.fillStyle = '#E74C3C';
  ctx.fillRect(glassX + 2, glassY + 3, itemW, itemH);
  ctx.fillStyle = '#F1C40F';
  ctx.fillRect(glassX + 2, glassY + 3 + itemH + 2, itemW, itemH);
  ctx.fillStyle = '#3498DB';
  ctx.fillRect(glassX + 2, glassY + 3 + (itemH + 2) * 2, itemW, itemH);
  // Coin slot
  ctx.fillStyle = '#2A2A3E';
  ctx.fillRect(bodyX + bodyW - 5, bodyY + bodyH * 0.5, 3, 6);
}

function drawRugTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Base
  ctx.fillStyle = RUG_COLOR;
  ctx.fillRect(sx, sy, size, size);
  // Diamond / cross pattern
  const mid = size / 2;
  const pw = Math.max(2, size * 0.12);
  ctx.fillStyle = RUG_PATTERN;
  // Vertical stripe
  ctx.fillRect(sx + mid - pw / 2, sy, pw, size);
  // Horizontal stripe
  ctx.fillRect(sx, sy + mid - pw / 2, size, pw);
  // Corner accents
  ctx.fillRect(sx + size * 0.2, sy + size * 0.2, pw, pw);
  ctx.fillRect(sx + size * 0.8 - pw, sy + size * 0.2, pw, pw);
  ctx.fillRect(sx + size * 0.2, sy + size * 0.8 - pw, pw, pw);
  ctx.fillRect(sx + size * 0.8 - pw, sy + size * 0.8 - pw, pw, pw);
}

function drawPosterTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Wall background
  ctx.fillStyle = WALL_COLOR;
  ctx.fillRect(sx, sy, size, size);
  ctx.fillStyle = '#252535';
  ctx.fillRect(sx, sy, size, Math.max(1, 1));
  ctx.fillRect(sx, sy, Math.max(1, 1), size);
  // Poster frame
  const frameW = size * 0.5;
  const frameH = size * 0.55;
  const frameX = sx + (size - frameW) / 2;
  const frameY = sy + (size - frameH) / 2;
  // Border
  ctx.fillStyle = '#B8922F';
  ctx.fillRect(frameX - 1, frameY - 1, frameW + 2, frameH + 2);
  // Poster background
  ctx.fillStyle = POSTER_BG;
  ctx.fillRect(frameX, frameY, frameW, frameH);
  // Abstract art detail
  ctx.fillStyle = '#C0392B';
  ctx.fillRect(frameX + 3, frameY + 3, frameW * 0.4, frameH * 0.3);
  ctx.fillStyle = '#2980B9';
  ctx.fillRect(frameX + frameW * 0.5, frameY + frameH * 0.4, frameW * 0.35, frameH * 0.35);
}

function drawClockTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number) {
  // Wall background
  ctx.fillStyle = WALL_COLOR;
  ctx.fillRect(sx, sy, size, size);
  ctx.fillStyle = '#252535';
  ctx.fillRect(sx, sy, size, Math.max(1, 1));
  ctx.fillRect(sx, sy, Math.max(1, 1), size);
  // Clock frame (square representing circle)
  const clockSize = size * 0.35;
  const clockX = sx + (size - clockSize) / 2;
  const clockY = sy + (size - clockSize) / 2;
  ctx.fillStyle = CLOCK_FRAME;
  ctx.fillRect(clockX - 1, clockY - 1, clockSize + 2, clockSize + 2);
  // Clock face
  ctx.fillStyle = CLOCK_FACE;
  ctx.fillRect(clockX, clockY, clockSize, clockSize);
  // 12 o'clock marker
  const cx = clockX + clockSize / 2;
  const cy = clockY + clockSize / 2;
  ctx.fillStyle = CLOCK_FRAME;
  ctx.fillRect(cx - 1, clockY + 1, 2, 2);
  // Hour hand
  ctx.fillStyle = '#333348';
  ctx.fillRect(cx - 1, cy - clockSize * 0.25, 2, clockSize * 0.25);
  // Minute hand
  ctx.fillRect(cx, cy - clockSize * 0.35, 1, clockSize * 0.35);
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
          if ((c + r) % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.02)';
            ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
          }
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
        case TileType.CHAIR:
          ctx.fillStyle = FLOOR_COLOR;
          ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
          drawChairTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.PLANT:
          drawPlantTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.BOOKSHELF:
          drawBookshelfTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.SOFA:
          drawSofaTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.COFFEE_MACHINE:
          drawCoffeeMachineTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.WHITEBOARD:
          drawWhiteboardTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.MEETING_TABLE:
          drawMeetingTableTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.SNACK_MACHINE:
          drawSnackMachineTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.POSTER:
          drawPosterTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.CLOCK:
          drawClockTile(ctx, sx, sy, tileScreenSize);
          break;
        case TileType.RUG:
          ctx.fillStyle = FLOOR_COLOR;
          ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
          drawRugTile(ctx, sx, sy, tileScreenSize);
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
