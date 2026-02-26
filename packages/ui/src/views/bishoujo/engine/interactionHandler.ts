import {
  MOUSE_TRACK_STRENGTH,
  MOUSE_TRACK_DAMPING,
  CLICK_SURPRISE_DURATION,
} from './constants.ts';

export interface InteractionState {
  // Mouse tracking (normalised -1..1 relative to canvas center)
  mouseX: number;
  mouseY: number;
  // Smoothed tracking values
  smoothX: number;
  smoothY: number;
  // Click reaction
  clickedSessionId: string | null;
  clickTimer: number;
  // Drag state
  dragging: string | null;
  dragOffsetX: number;
  dragOffsetY: number;
}

export function createInteractionState(): InteractionState {
  return {
    mouseX: 0,
    mouseY: 0,
    smoothX: 0,
    smoothY: 0,
    clickedSessionId: null,
    clickTimer: 0,
    dragging: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
  };
}

/**
 * Update smooth mouse tracking values.
 * Call once per frame.
 */
export function updateTracking(state: InteractionState, dt: number): void {
  const factor = 1 - Math.pow(1 - MOUSE_TRACK_DAMPING, dt * 60);
  state.smoothX += (state.mouseX - state.smoothX) * factor;
  state.smoothY += (state.mouseY - state.smoothY) * factor;

  if (state.clickTimer > 0) {
    state.clickTimer = Math.max(0, state.clickTimer - dt);
    if (state.clickTimer <= 0) {
      state.clickedSessionId = null;
    }
  }
}

/**
 * Convert smooth mouse position to head/eye tracking degrees.
 */
export function getTrackingAngles(state: InteractionState): {
  angleX: number;
  angleY: number;
  eyeBallX: number;
  eyeBallY: number;
} {
  return {
    angleX: state.smoothY * MOUSE_TRACK_STRENGTH * 0.5,
    angleY: state.smoothX * MOUSE_TRACK_STRENGTH,
    eyeBallX: state.smoothX * 0.8,
    eyeBallY: state.smoothY * 0.5,
  };
}

/**
 * Record a click on a character.
 */
export function triggerClick(state: InteractionState, sessionId: string): void {
  state.clickedSessionId = sessionId;
  state.clickTimer = CLICK_SURPRISE_DURATION;
}

/**
 * Start dragging a character.
 */
export function startDrag(
  state: InteractionState,
  sessionId: string,
  offsetX: number,
  offsetY: number,
): void {
  state.dragging = sessionId;
  state.dragOffsetX = offsetX;
  state.dragOffsetY = offsetY;
}

/**
 * End dragging.
 */
export function endDrag(state: InteractionState): void {
  state.dragging = null;
}
