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
  // left = flipped right (handled at render time)
}

export interface SpriteSet {
  idle: DirectionalFrames;
  walk: { down: HTMLCanvasElement[]; up: HTMLCanvasElement[]; right: HTMLCanvasElement[] };
  type: HTMLCanvasElement[];
  read: HTMLCanvasElement[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function createSpriteCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = CHAR_WIDTH;
  canvas.height = CHAR_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// ── Draw functions ──────────────────────────────────────────────────────

// Character layout (16x32):
//   Hair:   row 0-3   (top of head)
//   Head:   row 2-9   (8px tall, centered)
//   Body:   row 10-21 (12px tall)
//   Legs:   row 22-29 (8px tall)
//   Feet:   row 30-31

function drawHead(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  // Hair (top of head)
  fillRect(ctx, 4, 0, 8, 4, p.hair);
  // Face / head
  fillRect(ctx, 4, 2, 8, 8, p.skin);
  // Hair sides
  fillRect(ctx, 4, 2, 2, 3, p.hair);
  fillRect(ctx, 10, 2, 2, 3, p.hair);
  // Eyes (looking down)
  fillRect(ctx, 6, 6, 2, 1, '#222');
  fillRect(ctx, 9, 6, 2, 1, '#222');
}

function drawHeadUp(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  // Hair covers most of back of head
  fillRect(ctx, 4, 0, 8, 4, p.hair);
  fillRect(ctx, 4, 2, 8, 8, p.hair);
  // Small strip of skin at neck
  fillRect(ctx, 5, 8, 6, 2, p.skin);
}

function drawHeadRight(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fillRect(ctx, 4, 0, 8, 4, p.hair);
  fillRect(ctx, 4, 2, 8, 8, p.skin);
  // Hair on left side
  fillRect(ctx, 4, 2, 3, 4, p.hair);
  // Eye (right-facing, single eye visible)
  fillRect(ctx, 10, 6, 1, 1, '#222');
}

function drawBody(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  fillRect(ctx, 3, 10, 10, 12, p.shirt);
}

function drawBodyWithArms(ctx: CanvasRenderingContext2D, p: CharacterPalette, leftArmDown: boolean, rightArmDown: boolean) {
  // Torso
  fillRect(ctx, 4, 10, 8, 12, p.shirt);
  // Arms
  if (leftArmDown) {
    fillRect(ctx, 2, 11, 2, 9, p.shirt);
    fillRect(ctx, 2, 20, 2, 1, p.skin); // hand
  } else {
    // arm raised forward
    fillRect(ctx, 2, 11, 2, 6, p.shirt);
    fillRect(ctx, 2, 17, 2, 1, p.skin);
  }
  if (rightArmDown) {
    fillRect(ctx, 12, 11, 2, 9, p.shirt);
    fillRect(ctx, 12, 20, 2, 1, p.skin);
  } else {
    fillRect(ctx, 12, 11, 2, 6, p.shirt);
    fillRect(ctx, 12, 17, 2, 1, p.skin);
  }
}

function drawLegsStanding(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  // Left leg
  fillRect(ctx, 4, 22, 4, 8, p.pants);
  // Right leg
  fillRect(ctx, 8, 22, 4, 8, p.pants);
  // Feet
  fillRect(ctx, 4, 30, 4, 2, '#1a1a1a');
  fillRect(ctx, 8, 30, 4, 2, '#1a1a1a');
}

function drawLegsWalkFrame1(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  // Left leg forward
  fillRect(ctx, 3, 22, 4, 8, p.pants);
  fillRect(ctx, 3, 30, 4, 2, '#1a1a1a');
  // Right leg back
  fillRect(ctx, 9, 22, 4, 8, p.pants);
  fillRect(ctx, 9, 30, 4, 2, '#1a1a1a');
}

function drawLegsWalkFrame2(ctx: CanvasRenderingContext2D, p: CharacterPalette) {
  // Left leg back
  fillRect(ctx, 3, 22, 4, 8, p.pants);
  fillRect(ctx, 3, 30, 4, 2, '#1a1a1a');
  // Right leg forward
  fillRect(ctx, 9, 22, 4, 8, p.pants);
  fillRect(ctx, 9, 30, 4, 2, '#1a1a1a');
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
  if (frame === 0) drawLegsWalkFrame1(ctx, p);
  else drawLegsWalkFrame2(ctx, p);
  return canvas;
}

function drawWalkUp(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHeadUp(ctx, p);
  drawBody(ctx, p);
  if (frame === 0) drawLegsWalkFrame1(ctx, p);
  else drawLegsWalkFrame2(ctx, p);
  return canvas;
}

function drawWalkRight(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHeadRight(ctx, p);
  drawBody(ctx, p);
  if (frame === 0) drawLegsWalkFrame1(ctx, p);
  else drawLegsWalkFrame2(ctx, p);
  return canvas;
}

function drawTyping(p: CharacterPalette, frame: number): HTMLCanvasElement {
  const { canvas, ctx } = createSpriteCanvas();
  drawHead(ctx, p);
  // Arms alternate: one up, one slightly different
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
  // Both arms up holding book
  drawBodyWithArms(ctx, p, false, false);
  // Book shape between hands
  const bookY = frame === 0 ? 15 : 16;
  fillRect(ctx, 4, bookY, 8, 4, '#8B4513');
  fillRect(ctx, 5, bookY + 1, 6, 2, '#F5F5DC');
  drawLegsStanding(ctx, p);
  return canvas;
}

// ── Public API ──────────────────────────────────────────────────────────

const spriteCache = new Map<number, SpriteSet>();

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
