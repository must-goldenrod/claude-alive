import { useEffect, useRef, useCallback } from 'react';
import { Container } from 'pixi.js';
import { useApplication, useTick } from '@pixi/react';
import { Live2DModel } from '@naari3/pixi-live2d-display';
import type { AgentState, ToolAnimation } from '@claude-alive/core';
import { loadModel } from '../engine/live2dManager.ts';
import type { ModelName } from '../engine/constants.ts';
import {
  BREATH_PERIOD,
  BREATH_AMPLITUDE,
  BLINK_INTERVAL_MIN,
  BLINK_INTERVAL_MAX,
  BLINK_DURATION,
  IDLE_SWAY_PERIOD_MIN,
  IDLE_SWAY_AMPLITUDE,
  CLICK_SURPRISE_DURATION,
} from '../engine/constants.ts';
import {
  mapStateToParams,
  lerpTargets,
  type Live2DParamTargets,
} from '../engine/parameterMapper.ts';
import { createMood, onStateChange, tickMood, moodToOffsets } from '../engine/moodSystem.ts';
import { type InteractionState, getTrackingAngles } from '../engine/interactionHandler.ts';

interface Live2DCharacterProps {
  sessionId: string;
  modelName: ModelName;
  x: number;
  y: number;
  scale: number;
  zIndex: number;
  state: AgentState;
  animation: ToolAnimation | null;
  interaction: InteractionState;
  onLoaded?: (sessionId: string) => void;
}

/**
 * Manages a single Live2D character on the PixiJS stage.
 * Handles loading, parameter animation, auto-breath/blink, and interaction.
 */
export function Live2DCharacter({
  sessionId,
  modelName,
  x,
  y,
  scale,
  zIndex,
  state,
  animation,
  interaction,
  onLoaded,
}: Live2DCharacterProps) {
  const { app } = useApplication();
  const modelRef = useRef<Live2DModel | null>(null);
  const containerRef = useRef<Container | null>(null);
  const currentParams = useRef<Live2DParamTargets>(mapStateToParams('idle', null));
  const mood = useRef(createMood());
  const prevState = useRef<AgentState>(state);
  const elapsed = useRef(0);
  const nextBlink = useRef(randomBlink());
  const blinkPhase = useRef<'none' | 'closing' | 'opening'>('none');
  const blinkTimer = useRef(0);
  const swayOffset = useRef(Math.random() * Math.PI * 2);
  // Spawn animation
  const spawnProgress = useRef(0);
  const isSpawning = useRef(true);

  // Load model on mount
  useEffect(() => {
    let cancelled = false;
    const container = new Container();
    container.zIndex = zIndex;
    container.sortableChildren = true;
    containerRef.current = container;

    // Add to stage immediately for proper ordering
    app.stage.addChild(container);

    loadModel(modelName).then(model => {
      if (cancelled) {
        model.destroy();
        return;
      }
      modelRef.current = model;
      model.anchor.set(0.5, 0.87); // bottom-center anchor
      model.scale.set(scale);
      model.position.set(0, 0);
      model.alpha = 0; // start invisible for spawn animation
      container.addChild(model);
      container.position.set(x, y);
      onLoaded?.(sessionId);
    }).catch(err => {
      console.warn(`[bishoujo] Failed to load model for ${sessionId}:`, err);
    });

    return () => {
      cancelled = true;
      if (modelRef.current) {
        modelRef.current.destroy();
        modelRef.current = null;
      }
      if (containerRef.current) {
        app.stage.removeChild(containerRef.current);
        containerRef.current.destroy();
        containerRef.current = null;
      }
    };
  }, [app, modelName, sessionId, scale, zIndex, onLoaded, x, y]);

  // Update position when slot changes
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.position.set(x, y);
      containerRef.current.zIndex = zIndex;
    }
    if (modelRef.current) {
      modelRef.current.scale.set(scale);
    }
  }, [x, y, scale, zIndex]);

  // Track state changes for mood
  useEffect(() => {
    if (state !== prevState.current) {
      onStateChange(mood.current, state);
      prevState.current = state;
    }
  }, [state]);

  // Per-frame animation update
  const tick = useCallback(
    (ticker: { deltaTime: number; deltaMS: number }) => {
      const model = modelRef.current;
      if (!model) return;

      const dt = ticker.deltaMS / 1000;
      elapsed.current += dt;
      const t = elapsed.current;

      // ── Spawn animation ─────────────────────────
      if (isSpawning.current) {
        spawnProgress.current = Math.min(1, spawnProgress.current + dt * 2.5);
        const ease = 1 - Math.pow(1 - spawnProgress.current, 3); // easeOutCubic
        model.alpha = ease;
        model.scale.set(scale * (0.8 + 0.2 * ease));
        if (spawnProgress.current >= 1) {
          isSpawning.current = false;
          model.alpha = 1;
          model.scale.set(scale);
        }
      }

      // ── Target parameters from state ────────────
      const targets = mapStateToParams(state, animation);

      // ── Mood offsets ────────────────────────────
      tickMood(mood.current, dt);
      const moodOff = moodToOffsets(mood.current);

      // ── Smooth lerp ─────────────────────────────
      currentParams.current = lerpTargets(currentParams.current, targets, 0.08);
      const p = currentParams.current;

      // ── Auto-breath ─────────────────────────────
      const breathVal = Math.sin((t * Math.PI * 2) / BREATH_PERIOD) * BREATH_AMPLITUDE;

      // ── Auto-blink ──────────────────────────────
      let blinkMod = 1;
      nextBlink.current -= dt;
      if (nextBlink.current <= 0 && blinkPhase.current === 'none') {
        blinkPhase.current = 'closing';
        blinkTimer.current = 0;
      }
      if (blinkPhase.current === 'closing') {
        blinkTimer.current += dt;
        blinkMod = 1 - blinkTimer.current / BLINK_DURATION;
        if (blinkTimer.current >= BLINK_DURATION) {
          blinkPhase.current = 'opening';
          blinkTimer.current = 0;
        }
      } else if (blinkPhase.current === 'opening') {
        blinkTimer.current += dt;
        blinkMod = blinkTimer.current / BLINK_DURATION;
        if (blinkTimer.current >= BLINK_DURATION) {
          blinkPhase.current = 'none';
          nextBlink.current = randomBlink();
          blinkMod = 1;
        }
      }
      blinkMod = Math.max(0, Math.min(1, blinkMod));

      // ── Idle sway ───────────────────────────────
      const swayPeriod = IDLE_SWAY_PERIOD_MIN + 2;
      const sway = Math.sin((t * Math.PI * 2) / swayPeriod + swayOffset.current) * IDLE_SWAY_AMPLITUDE;

      // ── Mouse tracking ──────────────────────────
      const tracking = getTrackingAngles(interaction);

      // ── Click reaction ──────────────────────────
      let clickMod = 0;
      if (interaction.clickedSessionId === sessionId && interaction.clickTimer > 0) {
        clickMod = interaction.clickTimer / CLICK_SURPRISE_DURATION;
      }

      // ── Reading eye scan ────────────────────────
      let readingEyeX = 0;
      if (animation === 'reading') {
        readingEyeX = Math.sin(t * 2) * 0.5;
      } else if (animation === 'searching') {
        readingEyeX = Math.sin(t * 3) * 0.7;
      }

      // ── Apply to model ──────────────────────────
      // Use model.focus for head/eye tracking (built-in interpolation)
      const focusX = (tracking.eyeBallX + readingEyeX) * 500;
      const focusY = tracking.eyeBallY * 500;
      model.focus(focusX, focusY);

      // Direct parameter access via internalModel
      const im = model.internalModel;
      if (!im) return;
      const core = (im as any).coreModel;
      if (!core) return;

      // Helper to safely set param
      const set = (name: string, val: number) => {
        try {
          core.setParameterValueById?.(name, val);
        } catch {
          // param may not exist on this model
        }
      };

      // Body angle
      set('ParamBodyAngleX', p.bodyAngleX + sway + tracking.angleY * 0.3);
      set('ParamBodyAngleY', p.bodyAngleY);

      // Head
      set('ParamAngleX', p.angleX + tracking.angleX + (clickMod > 0 ? 5 : 0));
      set('ParamAngleZ', p.angleZ);

      // Eyes
      const eyeOpen = p.eyeLOpen * blinkMod + moodOff.eyeLOpen;
      set('ParamEyeLOpen', Math.max(0, eyeOpen + (clickMod > 0 ? 0.3 : 0)));
      set('ParamEyeROpen', Math.max(0, (p.eyeROpen * blinkMod + moodOff.eyeROpen) + (clickMod > 0 ? 0.3 : 0)));

      // Mouth
      set('ParamMouthOpenY', p.mouthOpenY + (clickMod > 0 ? 0.4 : 0));
      set('ParamMouthForm', p.mouthForm + moodOff.mouthForm);

      // Brows
      set('ParamBrowLY', p.browLY + moodOff.browLY);
      set('ParamBrowRY', p.browRY + moodOff.browRY);

      // Breath
      set('ParamBreath', breathVal);
    },
    [state, animation, interaction, sessionId, scale],
  );

  useTick(tick);

  // This component renders nothing in JSX — it manages a PixiJS Container imperatively
  return null;
}

function randomBlink(): number {
  return BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);
}
