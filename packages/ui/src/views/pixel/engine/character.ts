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
import i18n from '@claude-alive/i18n';

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
  bubbleText: string | null;
  bubbleLarge: boolean;

  // Pending animation (applied when arriving at seat after startToolActivity)
  pendingAnimation: 'typing' | 'reading' | null;

  // Sub-agent distinction
  isSubAgent: boolean;
  label: string | null; // display name shown above head

  // Tooltip (set by click)
  showTooltip: boolean;
  tooltipTool: string | null;

  // Selection (set by PixelOfficePage based on app-level selectedSessionId)
  isSelected?: boolean;
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
    bubbleText: null,
    bubbleLarge: false,

    pendingAnimation: null,

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
  // Keep render fn in sync with latest module logic (fixes HMR stale closures)
  char.render = makeRenderFn(char);
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

  const atSeat = char.seatCol !== null && char.seatRow !== null &&
      Math.round(char.tileX) === char.seatCol && Math.round(char.tileY) === char.seatRow;

  if (atSeat) {
    if (char.seatFacing) {
      char.direction = char.seatFacing;
    }
    // Apply pending animation from startToolActivity
    if (char.pendingAnimation) {
      char.state = char.pendingAnimation;
      char.pendingAnimation = null;
      char.animFrame = 0;
      char.animTimer = 0;
      return;
    }
  }

  char.pendingAnimation = null;
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
        char.pendingAnimation = animation;
        char.path = path;
        char.pathIndex = 0;
        char.state = 'walking';
        char.animFrame = 0;
        char.animTimer = 0;
        return;
      }
    }
  }

  char.pendingAnimation = null;
  char.state = animation;
  char.animFrame = 0;
  char.animTimer = 0;
  if (char.seatFacing) {
    char.direction = char.seatFacing;
  }
}

export function setCharacterIdle(char: Character): void {
  char.state = 'idle';
  char.pendingAnimation = null;
  char.animFrame = 0;
  char.animTimer = 0;
  char.wanderTimer = randomWanderTime();
  char.bubble = 'none';
  char.bubbleText = null;
  char.bubbleLarge = false;
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

    // Active glow border (typing/reading, or walking with pending animation)
    const isActive = char.state === 'typing' || char.state === 'reading' || char.pendingAnimation !== null;
    if (isActive) {
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 6 * zoom;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * zoom;
      ctx.beginPath();
      ctx.roundRect(-2 * zoom, -2 * zoom, w + 4 * zoom, h + 4 * zoom, 3 * zoom);
      ctx.stroke();
      ctx.restore();
    }

    // Selection halo (drawn outside the active glow so both can coexist visually).
    // Uses the same accent-blue tone as the sidebar's selected state for cross-surface
    // recognition.
    if (char.isSelected) {
      ctx.save();
      ctx.shadowColor = '#58a6ff';
      ctx.shadowBlur = 12 * zoom;
      ctx.strokeStyle = '#58a6ff';
      ctx.lineWidth = 2 * zoom;
      ctx.beginPath();
      ctx.roundRect(-5 * zoom, -5 * zoom, w + 10 * zoom, h + 10 * zoom, 5 * zoom);
      ctx.stroke();
      ctx.restore();
    }

    // Name label above head (all characters)
    const labelName = char.label || i18n.t('agents.generalAgent');
    const labelH = drawNameLabel(ctx, labelName, w, zoom);

    // Speech bubble (positioned above name label)
    if (char.bubbleText) {
      drawSpeechBubble(ctx, char.bubbleText, w, zoom, labelH, char.bubbleLarge);
    } else if (char.bubble !== 'none') {
      drawBubble(ctx, char.bubble, w, zoom);
    }

    // Tooltip (only when tool info available)
    if (char.tooltipTool) {
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

/** Returns total height occupied above character (bgH + gap) */
function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  name: string,
  charWidth: number,
  zoom: number,
): number {
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

  return bgH + 2 * zoom;
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

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  charWidth: number,
  zoom: number,
  labelHeight: number,
  large = false,
) {
  const baseFontSize = Math.max(9, 5 * zoom);
  const fontSize = large ? baseFontSize * 2 : baseFontSize;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textWidth = ctx.measureText(text).width;
  const padX = 6 * zoom;
  const padY = 5 * zoom;
  const bubbleW = textWidth + padX * 2;
  const bubbleH = fontSize + padY * 2;
  const tailH = 4 * zoom;

  const bx = charWidth / 2 - bubbleW / 2;
  const by = -bubbleH - tailH - 10 * zoom - labelHeight;

  // Bubble body (pixel-art: sharp corners)
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx, by, bubbleW, bubbleH);

  // Border
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, zoom * 0.5);
  ctx.strokeRect(bx, by, bubbleW, bubbleH);

  // Tail (small triangle pointing down)
  const tailX = charWidth / 2;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(tailX - 2 * zoom, by + bubbleH);
  ctx.lineTo(tailX, by + bubbleH + tailH);
  ctx.lineTo(tailX + 2 * zoom, by + bubbleH);
  ctx.closePath();
  ctx.fill();

  // Tail border (left and right edges only)
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(tailX - 2 * zoom, by + bubbleH);
  ctx.lineTo(tailX, by + bubbleH + tailH);
  ctx.lineTo(tailX + 2 * zoom, by + bubbleH);
  ctx.stroke();

  // Text
  ctx.fillStyle = '#333';
  ctx.fillText(text, charWidth / 2, by + bubbleH / 2);
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  char: Character,
  charWidth: number,
  zoom: number,
) {
  const name = char.label || i18n.t('agents.generalAgent');
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
