import type { Entity } from './renderer';
import type { SpriteSet } from './sprites';
import type { TileMap } from './tilemap';
import type { Direction } from './seats';
import type { MatrixEffect } from './matrixEffect';
import { generateSpriteSet } from './sprites';
import { findPath, isWalkable } from './tilemap';
import { TILE_SIZE, CHAR_WIDTH, CHAR_HEIGHT, WALK_SPEED } from './constants';
import { renderMatrixEffect, getEffectCharacterOpacity } from './matrixEffect';

// ── Types ───────────────────────────────────────────────────────────────

export type CharacterState = 'idle' | 'walking' | 'typing' | 'reading' | 'waiting' | 'error';

export interface Character extends Entity {
  id: string;
  sessionId: string;
  state: CharacterState;
  direction: Direction;

  // Position in tile coordinates (float for smooth movement)
  tileX: number;
  tileY: number;

  // Walking
  path: { col: number; row: number }[] | null;
  pathIndex: number;

  // Seat assignment
  seatCol: number | null;
  seatRow: number | null;
  seatFacing: Direction | null;

  // Animation
  animFrame: number;
  animTimer: number;

  // Idle wander timer
  wanderTimer: number;

  // Sprite
  sprites: SpriteSet;
  paletteIndex: number;

  // Speech bubble
  bubble: 'none' | 'waiting' | 'permission' | 'error';
}

// ── Constants ───────────────────────────────────────────────────────────

const WALK_ANIM_PERIOD = 0.3;   // seconds per walk frame
const ACTION_ANIM_PERIOD = 0.5; // seconds per type/read frame
const WANDER_MIN = 5;           // minimum seconds between wanders
const WANDER_MAX = 10;          // maximum seconds between wanders
const WANDER_RANGE = 3;         // max tiles to wander from seat

// ── Creation ────────────────────────────────────────────────────────────

export function createCharacter(
  id: string,
  sessionId: string,
  paletteIndex: number,
  startCol: number,
  startRow: number,
): Character {
  const sprites = generateSpriteSet(paletteIndex);

  const char: Character = {
    id,
    sessionId,
    state: 'idle',
    direction: 'down',

    tileX: startCol,
    tileY: startRow,

    path: null,
    pathIndex: 0,

    seatCol: null,
    seatRow: null,
    seatFacing: null,

    animFrame: 0,
    animTimer: 0,
    wanderTimer: randomWanderTime(),

    sprites,
    paletteIndex,

    bubble: 'none',

    // Entity fields (updated each frame in syncEntityPosition)
    x: startCol * TILE_SIZE,
    y: (startRow + 1) * TILE_SIZE, // bottom of sprite
    width: CHAR_WIDTH,
    height: CHAR_HEIGHT,

    render: () => {}, // set below
  };

  char.render = makeRenderFn(char);
  return char;
}

// ── Update ──────────────────────────────────────────────────────────────

export function updateCharacter(char: Character, dt: number, tileMap: TileMap): void {
  switch (char.state) {
    case 'walking':
      updateWalking(char, dt);
      break;
    case 'typing':
    case 'reading':
      updateActionAnim(char, dt);
      break;
    case 'idle':
      updateIdle(char, dt, tileMap);
      break;
    case 'waiting':
    case 'error':
      // Static, no animation updates needed
      break;
  }

  syncEntityPosition(char);
}

function updateWalking(char: Character, dt: number) {
  if (!char.path || char.pathIndex >= char.path.length) {
    // Arrived at destination
    arriveAtDestination(char);
    return;
  }

  const target = char.path[char.pathIndex];
  const dx = target.col - char.tileX;
  const dy = target.row - char.tileY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.05) {
    // Snap to tile and move to next waypoint
    char.tileX = target.col;
    char.tileY = target.row;
    char.pathIndex++;

    if (char.pathIndex >= char.path.length) {
      arriveAtDestination(char);
      return;
    }
  } else {
    // Move toward target
    const step = Math.min(WALK_SPEED * dt, dist);
    char.tileX += (dx / dist) * step;
    char.tileY += (dy / dist) * step;

    // Update direction based on dominant movement axis
    if (Math.abs(dx) > Math.abs(dy)) {
      char.direction = dx > 0 ? 'right' : 'left';
    } else {
      char.direction = dy > 0 ? 'down' : 'up';
    }
  }

  // Walk animation
  char.animTimer += dt;
  if (char.animTimer >= WALK_ANIM_PERIOD) {
    char.animTimer -= WALK_ANIM_PERIOD;
    char.animFrame = (char.animFrame + 1) % 2;
  }
}

function arriveAtDestination(char: Character) {
  char.path = null;
  char.pathIndex = 0;

  // If at seat, face desk
  if (char.seatCol !== null && char.seatRow !== null &&
      Math.round(char.tileX) === char.seatCol && Math.round(char.tileY) === char.seatRow) {
    if (char.seatFacing) {
      char.direction = char.seatFacing;
    }
  }

  char.state = 'idle';
  char.animFrame = 0;
  char.animTimer = 0;
  char.wanderTimer = randomWanderTime();
}

function updateIdle(char: Character, dt: number, tileMap: TileMap) {
  char.wanderTimer -= dt;
  if (char.wanderTimer <= 0) {
    char.wanderTimer = randomWanderTime();
    tryWander(char, tileMap);
  }
}

function tryWander(char: Character, tileMap: TileMap) {
  // Pick a random walkable tile nearby
  const baseCol = char.seatCol ?? Math.round(char.tileX);
  const baseRow = char.seatRow ?? Math.round(char.tileY);

  for (let attempt = 0; attempt < 5; attempt++) {
    const dc = Math.floor(Math.random() * (WANDER_RANGE * 2 + 1)) - WANDER_RANGE;
    const dr = Math.floor(Math.random() * (WANDER_RANGE * 2 + 1)) - WANDER_RANGE;
    const targetCol = baseCol + dc;
    const targetRow = baseRow + dr;

    if (!isWalkable(tileMap, targetCol, targetRow)) continue;
    if (targetCol === Math.round(char.tileX) && targetRow === Math.round(char.tileY)) continue;

    const fromCol = Math.round(char.tileX);
    const fromRow = Math.round(char.tileY);
    const path = findPath(tileMap, { col: fromCol, row: fromRow }, { col: targetCol, row: targetRow });
    if (path && path.length > 0) {
      char.path = path;
      char.pathIndex = 0;
      char.state = 'walking';
      char.animFrame = 0;
      char.animTimer = 0;
      return;
    }
  }
}

function updateActionAnim(char: Character, dt: number) {
  char.animTimer += dt;
  if (char.animTimer >= ACTION_ANIM_PERIOD) {
    char.animTimer -= ACTION_ANIM_PERIOD;
    char.animFrame = (char.animFrame + 1) % 2;
  }
}

// ── Public actions ──────────────────────────────────────────────────────

/** Assign a seat. Character will walk there if not already there. */
export function assignSeat(
  char: Character,
  col: number,
  row: number,
  facing: Direction,
  tileMap: TileMap,
): void {
  char.seatCol = col;
  char.seatRow = row;
  char.seatFacing = facing;

  // Walk to seat if not already there
  const curCol = Math.round(char.tileX);
  const curRow = Math.round(char.tileY);
  if (curCol !== col || curRow !== row) {
    const path = findPath(tileMap, { col: curCol, row: curRow }, { col, row });
    if (path && path.length > 0) {
      char.path = path;
      char.pathIndex = 0;
      char.state = 'walking';
      char.animFrame = 0;
      char.animTimer = 0;
    }
  } else {
    char.direction = facing;
  }
}

/** Start typing or reading animation. Character walks to seat first if needed. */
export function startToolActivity(
  char: Character,
  animation: 'typing' | 'reading',
  tileMap: TileMap,
): void {
  // If we have a seat and aren't there, walk there first
  if (char.seatCol !== null && char.seatRow !== null) {
    const curCol = Math.round(char.tileX);
    const curRow = Math.round(char.tileY);
    if (curCol !== char.seatCol || curRow !== char.seatRow) {
      const path = findPath(
        tileMap,
        { col: curCol, row: curRow },
        { col: char.seatCol, row: char.seatRow },
      );
      if (path && path.length > 0) {
        char.path = path;
        char.pathIndex = 0;
        char.state = 'walking';
        char.animFrame = 0;
        char.animTimer = 0;
        // Activity will start when arriving -- for now just set walking
        return;
      }
    }
  }

  char.state = animation;
  char.animFrame = 0;
  char.animTimer = 0;
  if (char.seatFacing) {
    char.direction = char.seatFacing;
  }
}

/** Return character to idle */
export function setCharacterIdle(char: Character): void {
  char.state = 'idle';
  char.animFrame = 0;
  char.animTimer = 0;
  char.wanderTimer = randomWanderTime();
  char.bubble = 'none';
}

// ── Rendering ───────────────────────────────────────────────────────────

function syncEntityPosition(char: Character) {
  char.x = char.tileX * TILE_SIZE;
  char.y = (char.tileY + 1) * TILE_SIZE; // bottom of sprite = bottom of tile
}

function makeRenderFn(char: Character): (ctx: CanvasRenderingContext2D, zoom: number) => void {
  return (ctx: CanvasRenderingContext2D, zoom: number) => {
    const sprite = getCurrentSprite(char);
    const flipH = char.direction === 'left';

    const w = CHAR_WIDTH * zoom;
    const h = CHAR_HEIGHT * zoom;

    ctx.imageSmoothingEnabled = false;

    if (flipH) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(sprite, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(sprite, 0, 0, w, h);
    }

    // Speech bubble
    if (char.bubble !== 'none') {
      drawBubble(ctx, char.bubble, w, zoom);
    }
  };
}

function getCurrentSprite(char: Character): HTMLCanvasElement {
  const { sprites, state, direction, animFrame } = char;
  // Resolve direction for sprites (left uses right sprites, flipped at render)
  const spriteDir = direction === 'left' ? 'right' : direction;

  switch (state) {
    case 'walking':
      return sprites.walk[spriteDir][animFrame % 2];
    case 'typing':
      return sprites.type[animFrame % 2];
    case 'reading':
      return sprites.read[animFrame % 2];
    case 'idle':
    case 'waiting':
    case 'error':
    default:
      return sprites.idle[spriteDir];
  }
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  type: 'waiting' | 'permission' | 'error',
  charWidth: number,
  zoom: number,
) {
  const bubbleSize = Math.max(4, 3 * zoom);
  const bx = charWidth / 2 - bubbleSize / 2;
  const by = -bubbleSize - zoom;

  const colors: Record<string, string> = {
    waiting: '#F39C12',
    permission: '#3498DB',
    error: '#E74C3C',
  };

  ctx.fillStyle = colors[type] ?? '#fff';
  ctx.beginPath();
  ctx.arc(bx + bubbleSize / 2, by + bubbleSize / 2, bubbleSize / 2, 0, Math.PI * 2);
  ctx.fill();

  // Icon inside
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.max(6, 2 * zoom)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const icons: Record<string, string> = { waiting: '…', permission: '?', error: '!' };
  ctx.fillText(icons[type] ?? '', bx + bubbleSize / 2, by + bubbleSize / 2);
}

// ── Effect entity ───────────────────────────────────────────────────────

/** Create an entity that renders a character with a matrix effect overlay */
export function makeEffectEntity(char: Character, effect: MatrixEffect): Entity {
  return {
    x: char.x,
    y: char.y,
    width: char.width,
    height: char.height,
    render: (ctx: CanvasRenderingContext2D, zoom: number) => {
      const opacity = getEffectCharacterOpacity(effect);

      // Draw character with opacity
      if (opacity > 0) {
        ctx.save();
        ctx.globalAlpha = opacity;
        char.render(ctx, zoom);
        ctx.restore();
      }

      // Draw matrix rain on top
      renderMatrixEffect(ctx, effect, CHAR_WIDTH, CHAR_HEIGHT, zoom);
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function randomWanderTime(): number {
  return WANDER_MIN + Math.random() * (WANDER_MAX - WANDER_MIN);
}
