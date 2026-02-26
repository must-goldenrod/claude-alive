import type { AgentState } from '@claude-alive/core';

export interface Mood {
  happiness: number;  // -1..1
  energy: number;     // 0..1 (1 = fresh, 0 = exhausted)
  stress: number;     // 0..1
}

const DECAY_RATE = 0.002; // per second, mood drifts toward neutral

export function createMood(): Mood {
  return { happiness: 0.3, energy: 1, stress: 0 };
}

/**
 * Update mood based on agent state transitions.
 * Call when agent state changes.
 */
export function onStateChange(mood: Mood, newState: AgentState): void {
  switch (newState) {
    case 'active':
      mood.energy = Math.max(0, mood.energy - 0.01);
      break;
    case 'error':
      mood.stress = Math.min(1, mood.stress + 0.15);
      mood.happiness = Math.max(-1, mood.happiness - 0.1);
      break;
    case 'done':
      mood.happiness = Math.min(1, mood.happiness + 0.2);
      mood.stress = Math.max(0, mood.stress - 0.1);
      break;
    case 'idle':
      mood.energy = Math.min(1, mood.energy + 0.05);
      break;
  }
}

/**
 * Tick mood toward neutral over time.
 */
export function tickMood(mood: Mood, dt: number): void {
  const decay = DECAY_RATE * dt;
  mood.happiness += (0 - mood.happiness) * decay;
  mood.stress += (0 - mood.stress) * decay;
  mood.energy += (0.8 - mood.energy) * decay * 0.5;
}

/**
 * Get parameter offsets from mood for blending into Live2D.
 */
export function moodToOffsets(mood: Mood): {
  mouthForm: number;
  eyeLOpen: number;
  eyeROpen: number;
  browLY: number;
  browRY: number;
} {
  return {
    mouthForm: mood.happiness * 0.3,
    eyeLOpen: mood.energy > 0.3 ? 0 : (0.3 - mood.energy) * -0.3,
    eyeROpen: mood.energy > 0.3 ? 0 : (0.3 - mood.energy) * -0.3,
    browLY: mood.stress * -0.2,
    browRY: mood.stress * -0.2,
  };
}
