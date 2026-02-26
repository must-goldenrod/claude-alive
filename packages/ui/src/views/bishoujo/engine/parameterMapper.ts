import type { AgentState, ToolAnimation } from '@claude-alive/core';

/**
 * Target values for Live2D parameters driven by agent state.
 * These are *offsets* from the auto-animation baseline.
 */
export interface Live2DParamTargets {
  bodyAngleX: number;   // torso lean (degrees)
  bodyAngleY: number;
  angleX: number;       // head tilt
  angleY: number;
  angleZ: number;
  eyeLOpen: number;     // 0 = closed, 1 = normal, 1.2 = wide
  eyeROpen: number;
  eyeBallX: number;     // -1..1 gaze direction
  eyeBallY: number;
  mouthOpenY: number;   // 0..1
  mouthForm: number;    // -1 = frown, 0 = neutral, 1 = smile
  browLY: number;       // brow position (offset)
  browRY: number;
  eyeSquint: number;    // 0 = normal, 1 = full squint
}

const DEFAULTS: Live2DParamTargets = {
  bodyAngleX: 0,
  bodyAngleY: 0,
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  eyeLOpen: 1,
  eyeROpen: 1,
  eyeBallX: 0,
  eyeBallY: 0,
  mouthOpenY: 0,
  mouthForm: 0,
  browLY: 0,
  browRY: 0,
  eyeSquint: 0,
};

function targets(overrides: Partial<Live2DParamTargets>): Live2DParamTargets {
  return { ...DEFAULTS, ...overrides };
}

/**
 * Resolve agent state + tool animation → Live2D parameter targets.
 */
export function mapStateToParams(
  state: AgentState,
  animation: ToolAnimation | null,
): Live2DParamTargets {
  switch (state) {
    case 'idle':
    case 'done':
      return targets({ mouthForm: 0.2 }); // slight smile

    case 'listening':
      return targets({
        mouthOpenY: 0,
        mouthForm: 0.3,
        eyeBallX: 0,
        eyeBallY: 0,
      });

    case 'active':
      return mapToolTargets(animation);

    case 'waiting':
      return targets({
        mouthForm: 0.4,
        eyeBallX: 0,
        eyeBallY: -0.1,
        bodyAngleY: 2,
      });

    case 'error':
      return targets({
        eyeLOpen: 1.2,
        eyeROpen: 1.2,
        mouthForm: -0.5,
        browLY: -0.3,
        browRY: -0.3,
        bodyAngleX: 0,
      });

    case 'spawning':
      return targets({ mouthForm: 0.5, eyeLOpen: 1.1, eyeROpen: 1.1 });

    case 'despawning':
      return targets({ mouthForm: -0.2, eyeLOpen: 0.7, eyeROpen: 0.7 });

    default:
      return DEFAULTS;
  }
}

function mapToolTargets(animation: ToolAnimation | null): Live2DParamTargets {
  switch (animation) {
    case 'typing':
      return targets({
        bodyAngleX: 0,
        angleY: -3,
        eyeBallY: 0.2,
        eyeSquint: 0.2,
        mouthForm: 0.1,
      });
    case 'reading':
      return targets({
        eyeBallX: 0, // will oscillate in the animation loop
        eyeBallY: 0.1,
        eyeSquint: 0.15,
        mouthForm: 0,
      });
    case 'searching':
      return targets({
        eyeBallX: 0, // will oscillate wider
        eyeBallY: 0,
        mouthOpenY: 0.1,
        mouthForm: 0.2,
      });
    case 'thinking':
      return targets({
        angleX: 8,
        angleZ: -3,
        eyeBallY: -0.3,
        mouthForm: 0,
        browLY: 0.2,
        browRY: 0.2,
      });
    case 'running':
    default:
      return targets({
        eyeSquint: 0.1,
        mouthForm: 0.1,
      });
  }
}

/** Smoothly lerp current targets toward desired targets. */
export function lerpTargets(
  current: Live2DParamTargets,
  target: Live2DParamTargets,
  t: number,
): Live2DParamTargets {
  const result = { ...current };
  for (const key of Object.keys(target) as (keyof Live2DParamTargets)[]) {
    result[key] = current[key] + (target[key] - current[key]) * t;
  }
  return result;
}
