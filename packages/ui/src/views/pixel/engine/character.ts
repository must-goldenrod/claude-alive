import type { Entity } from './renderer';
import type { SpriteSet, SubAgentSpriteSet } from './sprites';
import type { TileMap } from './tilemap';
import type { Direction } from './seats';
import type { MatrixEffect } from './matrixEffect';
import { generateSpriteSet, generateSubAgentSprites } from './sprites';
import { findPath, isWalkable } from './tilemap';
import { TILE_SIZE, CHAR_WIDTH, CHAR_HEIGHT, WALK_SPEED } from './constants';
import { SUB_AGENT_WIDTH, SUB_AGENT_HEIGHT } from './sprites';
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
  subSprites: SubAgentSpriteSet | null;
  paletteIndex: number;

  // Speech bubble
  bubble: 'none' | 'waiting' | 'permission' | 'error';

  // Sub-agent distinction
  isSubAgent: boolean;
  label: string | null; // display name shown above head

  // Tooltip (set by click)
  showTooltip: boolean;
  tooltipTool: string | null;
}

// ── Constants ───────────────────────────────────────────────────────────

const WALK_ANIM_PERIOD = 0.3;
const ACTION_ANIM_PERIOD = 0.5;
const WANDER_MIN = 5;
const WANDER_MAX = 10;
const WANDER_RANGE = 3;

// ── Creation ────────────────────────────────────────────────────────────

export function createCharacter(
  id: string,
  sessionId: string,
  paletteIndex: number,
  startCol: number,
  startRow: number,
  isSubAgent = false,
  label: string | null = null,
): Character {
  const sprites = generateSpriteSet(paletteIndex);
  const subSprites = isSubAgent ? generateSubAgentSprites(paletteIndex) : null;
  const charW = isSubAgent ? SUB_AGENT_WIDTH : CHAR_WIDTH;
  const charH = isSubAgent ? SUB_AGENT_HEIGHT : CHAR_HEIGHT;

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
    subSprites,
    paletteIndex,

    bubble: 'none',

    isSubAgent,
    label,
    showTooltip: false,
    tooltipTool: null,

    // Entity fields
    x: startCol * TILE_SIZE,
    y: (startRow + 1) * TILE_SIZE,
    width: charW,
    height: charH,

    render: () => {},
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
      break;
  }

  syncEntityPosition(char);
}

function updateWalking(char: Character, dt: number) {
  if (!char.path || char.pathIndex >= char.path.length) {
    arriveAtDestination(char);
    return;
  }

  const target = char.path[char.pathIndex];
  const dx = target.col - char.tileX;
  const dy = target.row - char.tileY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.05) {
    char.tileX = target.col;
    char.tileY = target.row;
    char.pathIndex++;

    if (char.pathIndex >= char.path.length) {
      arriveAtDestination(char);
      return;
    }
  } else {
    const step = Math.min(WALK_SPEED * dt, dist);
    char.tileX += (dx / dist) * step;
    char.tileY += (dy / dist) * step;

    if (Math.abs(dx) > Math.abs(dy)) {
      char.direction = dx > 0 ? 'right' : 'left';
    } else {
      char.direction = dy > 0 ? 'down' : 'up';
    }
  }

  char.animTimer += dt;
  if (char.animTimer >= WALK_ANIM_PERIOD) {
    char.animTimer -= WALK_ANIM_PERIOD;
    char.animFrame = (char.animFrame + 1) % 2;
  }
}

function arriveAtDestination(char: Character) {
  char.path = null;
  char.pathIndex = 0;

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

export function startToolActivity(
  char: Character,
  animation: 'typing' | 'reading',
  tileMap: TileMap,
): void {
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
  char.y = (char.tileY + 1) * TILE_SIZE;
}

function makeRenderFn(char: Character): (ctx: CanvasRenderingContext2D, zoom: number) => void {
  return (ctx: CanvasRenderingContext2D, zoom: number) => {
    const sprite = getCurrentSprite(char);
    const flipH = char.direction === 'left';

    const w = char.width * zoom;
    const h = char.height * zoom;

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

    // Name label above head (sub-agents with labels)
    if (char.isSubAgent && char.label) {
      drawNameLabel(ctx, char.label, w, zoom);
    }

    // Speech bubble
    if (char.bubble !== 'none') {
      drawBubble(ctx, char.bubble, w, zoom);
    }

    // Click tooltip
    if (char.showTooltip) {
      drawTooltip(ctx, char, w, zoom);
    }
  };
}

function getCurrentSprite(char: Character): HTMLCanvasElement {
  const { sprites, subSprites, isSubAgent, state, direction, animFrame } = char;
  const spriteSet = isSubAgent && subSprites ? subSprites : sprites;
  const spriteDir = direction === 'left' ? 'right' : direction;

  switch (state) {
    case 'walking':
      return spriteSet.walk[spriteDir][animFrame % 2];
    case 'typing':
      return spriteSet.type[animFrame % 2];
    case 'reading':
      return spriteSet.read[animFrame % 2];
    case 'idle':
    case 'waiting':
    case 'error':
    default:
      return spriteSet.idle[spriteDir];
  }
}

function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  name: string,
  charWidth: number,
  zoom: number,
) {
  const fontSize = Math.max(8, 4 * zoom);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const textWidth = ctx.measureText(name).width;
  const padX = 3 * zoom;
  const padY = 2 * zoom;
  const bgW = textWidth + padX * 2;
  const bgH = fontSize + padY * 2;
  const bgX = charWidth / 2 - bgW / 2;
  const bgY = -bgH - 2 * zoom;

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.beginPath();
  ctx.roundRect(bgX, bgY, bgW, bgH, 2 * zoom);
  ctx.fill();

  // Text
  ctx.fillStyle = '#e0e0e8';
  ctx.fillText(name, charWidth / 2, bgY + bgH - padY);
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  type: 'waiting' | 'permission' | 'error',
  charWidth: number,
  zoom: number,
) {
  const bubbleSize = Math.max(6, 4 * zoom);
  const bx = charWidth / 2 - bubbleSize / 2;
  const by = -bubbleSize - 2 * zoom;

  const colors: Record<string, string> = {
    waiting: '#F39C12',
    permission: '#3498DB',
    error: '#E74C3C',
  };

  ctx.fillStyle = colors[type] ?? '#fff';
  ctx.beginPath();
  ctx.arc(bx + bubbleSize / 2, by + bubbleSize / 2, bubbleSize / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = `${Math.max(8, 3 * zoom)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const icons: Record<string, string> = { waiting: '...', permission: '?', error: '!' };
  ctx.fillText(icons[type] ?? '', bx + bubbleSize / 2, by + bubbleSize / 2);
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  char: Character,
  charWidth: number,
  zoom: number,
) {
  const name = char.label || char.sessionId.slice(0, 8);
  const tool = char.tooltipTool;
  const text = tool ? `${name}: ${tool}` : name;

  const fontSize = Math.max(8, 4 * zoom);
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const textWidth = ctx.measureText(text).width;
  const padX = 4 * zoom;
  const padY = 3 * zoom;
  const bgW = textWidth + padX * 2;
  const bgH = fontSize + padY * 2;
  const bgX = charWidth / 2 - bgW / 2;

  // Position: above name label if sub-agent, else above head
  const labelOffset = (char.isSubAgent && char.label) ? (fontSize + 6 * zoom) : 0;
  const bgY = -bgH - 4 * zoom - labelOffset;

  // Background with accent border
  ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
  ctx.beginPath();
  ctx.roundRect(bgX, bgY, bgW, bgH, 3 * zoom);
  ctx.fill();

  ctx.strokeStyle = '#448aff';
  ctx.lineWidth = Math.max(1, zoom * 0.5);
  ctx.beginPath();
  ctx.roundRect(bgX, bgY, bgW, bgH, 3 * zoom);
  ctx.stroke();

  // Text
  ctx.fillStyle = '#e0e0e8';
  ctx.fillText(text, charWidth / 2, bgY + bgH - padY);
}

// ── Effect entity ───────────────────────────────────────────────────────

export function makeEffectEntity(char: Character, effect: MatrixEffect): Entity {
  return {
    x: char.x,
    y: char.y,
    width: char.width,
    height: char.height,
    render: (ctx: CanvasRenderingContext2D, zoom: number) => {
      const opacity = getEffectCharacterOpacity(effect);

      if (opacity > 0) {
        ctx.save();
        ctx.globalAlpha = opacity;
        char.render(ctx, zoom);
        ctx.restore();
      }

      renderMatrixEffect(ctx, effect, char.width, char.height, zoom);
    },
  };
}

// ── Hit testing ─────────────────────────────────────────────────────────

/** Check if world coordinates hit a character */
export function hitTestCharacter(
  char: Character,
  worldX: number,
  worldY: number,
): boolean {
  const left = char.x;
  const right = char.x + char.width;
  const top = char.y - char.height;
  const bottom = char.y;
  return worldX >= left && worldX <= right && worldY >= top && worldY <= bottom;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function randomWanderTime(): number {
  return WANDER_MIN + Math.random() * (WANDER_MAX - WANDER_MIN);
}
