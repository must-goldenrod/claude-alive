// ── Canvas ──────────────────────────────────────────
export const BG_COLOR = 0x1a1a2e;
export const BG_GRADIENT_TOP = '#1a1a2e';
export const BG_GRADIENT_BOTTOM = '#16213e';

// ── Live2D model catalog ────────────────────────────
export const MODEL_NAMES = ['Haru', 'Hiyori', 'Mark', 'Natori', 'Rice'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export function modelPath(name: ModelName): string {
  return `/live2d/models/${name}/${name}.model3.json`;
}

// ── Scene layout ────────────────────────────────────
export const MAX_SLOTS = 8;

// Slot positions: normalised [0..1] of canvas, plus scale
export interface SlotDef {
  x: number; // 0 = left, 1 = right
  y: number; // 0 = top, 1 = bottom
  scale: number;
  z: number; // draw order (higher = front)
}

// Pre-defined slots (front-row larger, back-row smaller for depth)
export const SLOTS: SlotDef[] = [
  // Back row (smaller)
  { x: 0.20, y: 0.35, scale: 0.22, z: 0 },
  { x: 0.50, y: 0.33, scale: 0.23, z: 0 },
  { x: 0.80, y: 0.35, scale: 0.22, z: 0 },
  // Mid row
  { x: 0.15, y: 0.55, scale: 0.28, z: 1 },
  { x: 0.50, y: 0.53, scale: 0.29, z: 1 },
  { x: 0.85, y: 0.55, scale: 0.28, z: 1 },
  // Front row (larger)
  { x: 0.30, y: 0.75, scale: 0.35, z: 2 },
  { x: 0.70, y: 0.75, scale: 0.35, z: 2 },
];

// ── Automatic animation defaults ────────────────────
export const BREATH_PERIOD = 3; // seconds
export const BREATH_AMPLITUDE = 0.5;
export const BLINK_INTERVAL_MIN = 3; // seconds
export const BLINK_INTERVAL_MAX = 7;
export const BLINK_DURATION = 0.15; // seconds
export const IDLE_SWAY_PERIOD_MIN = 5; // seconds
export const IDLE_SWAY_PERIOD_MAX = 8;
export const IDLE_SWAY_AMPLITUDE = 3; // degrees

// ── Interaction ─────────────────────────────────────
export const MOUSE_TRACK_STRENGTH = 30; // max degrees of eye/head follow
export const MOUSE_TRACK_DAMPING = 0.1; // lerp factor per frame
export const CLICK_SURPRISE_DURATION = 0.5; // seconds
export const DRAG_RESTORE_SPEED = 0.08; // lerp factor for snapping back

// ── Zoom / Pan ──────────────────────────────────────
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 1;
