import { CHAR_WIDTH, CHAR_HEIGHT } from './constants';

// ── Color palettes ──────────────────────────────────────────────────────

export const CHARACTER_PALETTES = [
  { skin: '#FFD5B8', shirt: '#4A90D9', pants: '#2C3E50', hair: '#3E2723' },
  { skin: '#FFD5B8', shirt: '#E74C3C', pants: '#2C3E50', hair: '#1A1A2E' },
  { skin: '#FFD5B8', shirt: '#2ECC71', pants: '#34495E', hair: '#4A3728' },
  { skin: '#FFD5B8', shirt: '#F39C12', pants: '#2C3E50', hair: '#2C1810' },
  { skin: '#FFD5B8', shirt: '#9B59B6', pants: '#2C3E50', hair: '#0D1117' },
  { skin: '#FFD5B8', shirt: '#1ABC9C', pants: '#34495E', hair: '#3E2723' },
] as const;

export type CharacterPalette = (typeof CHARACTER_PALETTES)[number];

// ── Sprite types ────────────────────────────────────────────────────────

export interface DirectionalFrames {
  down: HTMLCanvasElement;
  up: HTMLCanvasElement;
  right: HTMLCanvasElement;
}

export interface SpriteSet {
  idle: DirectionalFrames;
  walk: { down: HTMLCanvasElement[]; up: HTMLCanvasElement[]; right: HTMLCanvasElement[] };
  type: HTMLCanvasElement[];
  read: HTMLCanvasElement[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function createSpriteCanvas(w = CHAR_WIDTH, h = CHAR_HEIGHT): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function fill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// ── Draw functions (all coords are 2x of original 16x32) ───────────────
// Character layout (32x64):
//   Hair:   row 0-7   (top of head)
//   Head:   row 4-19  (16px tall)
//   Body:   row 20-43 (24px tall)
//   Legs:   row 44-59 (16px tall)
//   Feet:   row 60-63

function drawHead(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fill(ctx, 8, 0, 16, 8, p.hair);
  fill(ctx, 8, 4, 16, 16, p.skin);
  fill(ctx, 8, 4, 4, 6, p.hair);
  fill(ctx, 20, 4, 4, 6, p.hair);
  fill(ctx, 12, 12, 4, 2, '#222');
  fill(ctx, 18, 12, 4, 2, '#222');
}

function drawHeadUp(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fill(ctx, 8, 0, 16, 8, p.hair);
  fill(ctx, 8, 4, 16, 16, p.hair);
  fill(ctx, 10, 16, 12, 4, p.skin);
}

function drawHeadRight(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fill(ctx, 8, 0, 16, 8, p.hair);
  fill(ctx, 8, 4, 16, 16, p.skin);
  fill(ctx, 8, 4, 6, 8, p.hair);
  fill(ctx, 20, 12, 2, 2, '#222');
}

function drawBody(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fill(ctx, 6, 20, 20, 24, p.shirt);
}

function drawBodyWithArms(ctx: CanvasRenderingContext2D, p: CharacterPalette, leftDown: boolean, rightDown: boolean) {
  fill(ctx, 8, 20, 16, 24, p.shirt);
  if (leftDown) {
    fill(ctx, 4, 22, 4, 18, p.shirt);
    fill(ctx, 4, 40, 4, 2, p.skin);
  } else {
    fill(ctx, 4, 22, 4, 12, p.shirt);
    fill(ctx, 4, 34, 4, 2, p.skin);
  }
  if (rightDown) {
    fill(ctx, 24, 22, 4, 18, p.shirt);
    fill(ctx, 24, 40, 4, 2, p.skin);
  } else {
    fill(ctx, 24, 22, 4, 12, p.shirt);
    fill(ctx, 24, 34, 4, 2, p.skin);
  }
}

function drawLegsStanding(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fill(ctx, 8, 44, 8, 16, p.pants);
  fill(ctx, 16, 44, 8, 16, p.pants);
  fill(ctx, 8, 60, 8, 4, '#1a1a1a');
  fill(ctx, 16, 60, 8, 4, '#1a1a1a');
}

function drawLegsWalk1(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fill(ctx, 6, 44, 8, 16, p.pants);
  fill(ctx, 6, 60, 8, 4, '#1a1a1a');
  fill(ctx, 18, 44, 8, 16, p.pants);
  fill(ctx, 18, 60, 8, 4, '#1a1a1a');
}

function drawLegsWalk2(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fill(ctx, 6, 44, 8, 16, p.pants);
  fill(ctx, 6, 60, 8, 4, '#1a1a1a');
  fill(ctx, 18, 44, 8, 16, p.pants);
  fill(ctx, 18, 60, 8, 4, '#1a1a1a');
}

// ── Sprite generation ───────────────────────────────────────────────────

function drawIdleDown(p: CharacterPalette): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHead(ctx, p);
  drawBody(ctx, p);
  drawLegsStanding(ctx, p);
  return canvas;
}

function drawIdleUp(p: CharacterPalette): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHeadUp(ctx, p);
  drawBody(ctx, p);
  drawLegsStanding(ctx, p);
  return canvas;
}

function drawIdleRight(p: CharacterPalette): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHeadRight(ctx, p);
  drawBody(ctx, p);
  drawLegsStanding(ctx, p);
  return canvas;
}

function drawWalkDown(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHead(ctx, p);
  drawBody(ctx, p);
  if (frame === 0) drawLegsWalk1(ctx, p);
  else drawLegsWalk2(ctx, p);
  return canvas;
}

function drawWalkUp(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHeadUp(ctx, p);
  drawBody(ctx, p);
  if (frame === 0) drawLegsWalk1(ctx, p);
  else drawLegsWalk2(ctx, p);
  return canvas;
}

function drawWalkRight(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHeadRight(ctx, p);
  drawBody(ctx, p);
  if (frame === 0) drawLegsWalk1(ctx, p);
  else drawLegsWalk2(ctx, p);
  return canvas;
}

function drawTyping(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHead(ctx, p);
  if (frame === 0) {
    drawBodyWithArms(ctx, p, false, true);
  } else {
    drawBodyWithArms(ctx, p, true, false);
  }
  drawLegsStanding(ctx, p);
  return canvas;
}

function drawReading(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHead(ctx, p);
  drawBodyWithArms(ctx, p, false, false);
  const bookY = frame === 0 ? 30 : 32;
  fill(ctx, 8, bookY, 16, 8, '#8B4513');
  fill(ctx, 10, bookY + 2, 12, 4, '#F5F5DC');
  drawLegsStanding(ctx, p);
  return canvas;
}

// ── Sub-agent sprite generation (75% scale) ─────────────────────────────

const SUB_W = Math.round(CHAR_WIDTH * 0.75);
const SUB_H = Math.round(CHAR_HEIGHT * 0.75);

function createSubAgentSprite(fullSprite: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SUB_W;
  canvas.height = SUB_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fullSprite, 0, 0, SUB_W, SUB_H);
  return canvas;
}

export interface SubAgentSpriteSet {
  idle: DirectionalFrames;
  walk: { down: HTMLCanvasElement[]; up: HTMLCanvasElement[]; right: HTMLCanvasElement[] };
  type: HTMLCanvasElement[];
  read: HTMLCanvasElement[];
  width: number;
  height: number;
}

function generateSubAgentSpriteSet(full: SpriteSet): SubAgentSpriteSet {
  return {
    idle: {
      down: createSubAgentSprite(full.idle.down),
      up: createSubAgentSprite(full.idle.up),
      right: createSubAgentSprite(full.idle.right),
    },
    walk: {
      down: full.walk.down.map(createSubAgentSprite),
      up: full.walk.up.map(createSubAgentSprite),
      right: full.walk.right.map(createSubAgentSprite),
    },
    type: full.type.map(createSubAgentSprite),
    read: full.read.map(createSubAgentSprite),
    width: SUB_W,
    height: SUB_H,
  };
}

// ── Public API ──────────────────────────────────────────────────────────

const spriteCache = new Map<number, SpriteSet>();
const subSpriteCache = new Map<number, SubAgentSpriteSet>();

export function generateSpriteSet(paletteIndex: number): SpriteSet {
  const cached = spriteCache.get(paletteIndex);
  if (cached) return cached;

  const p = CHARACTER_PALETTES[paletteIndex % CHARACTER_PALETTES.length];

  const set: SpriteSet = {
    idle: {
      down: drawIdleDown(p),
      up: drawIdleUp(p),
      right: drawIdleRight(p),
    },
    walk: {
      down: [drawWalkDown(p, 0), drawWalkDown(p, 1)],
      up: [drawWalkUp(p, 0), drawWalkUp(p, 1)],
      right: [drawWalkRight(p, 0), drawWalkRight(p, 1)],
    },
    type: [drawTyping(p, 0), drawTyping(p, 1)],
    read: [drawReading(p, 0), drawReading(p, 1)],
  };

  spriteCache.set(paletteIndex, set);
  return set;
}

export function generateSubAgentSprites(paletteIndex: number): SubAgentSpriteSet {
  const cached = subSpriteCache.get(paletteIndex);
  if (cached) return cached;

  const full = generateSpriteSet(paletteIndex);
  const sub = generateSubAgentSpriteSet(full);
  subSpriteCache.set(paletteIndex, sub);
  return sub;
}

export { SUB_W as SUB_AGENT_WIDTH, SUB_H as SUB_AGENT_HEIGHT };
