import { Live2DModel } from '@naari3/pixi-live2d-display';
import type { ModelName } from './constants.ts';
import { modelPath } from './constants.ts';

// ── Model cache ──────────────────────────────────────
// We cache loaded model *instances*. Each agent gets its own clone,
// but the underlying textures/moc are shared by PixiJS internals.
const loadPromises = new Map<ModelName, Promise<Live2DModel>>();

/**
 * Load (or retrieve from cache) a Live2D model.
 * Returns a fresh Live2DModel instance ready to add to a PixiJS container.
 */
export async function loadModel(name: ModelName): Promise<Live2DModel> {
  // Always create a new instance (each character needs its own params).
  // The underlying .moc3 and textures are cached at the HTTP/browser level.
  const model = await Live2DModel.from(modelPath(name), {
    autoInteract: false,
    autoUpdate: true,
  });
  return model;
}

/**
 * Preload all models so they're ready when agents spawn.
 * Fires off loads in parallel; failures are logged but don't block.
 */
export function preloadAll(names: readonly ModelName[]): void {
  for (const name of names) {
    if (!loadPromises.has(name)) {
      const p = Live2DModel.from(modelPath(name), {
        autoInteract: false,
        autoUpdate: true,
      }).then(model => {
        // Destroy after preloading — we just want browser cache warmup
        model.destroy();
        return model;
      }).catch(err => {
        console.warn(`[bishoujo] Failed to preload model ${name}:`, err);
        throw err;
      });
      loadPromises.set(name, p);
    }
  }
}

/**
 * Apply a Live2D parameter by name with smooth blending.
 * Safe to call even if the parameter doesn't exist on this model.
 */
export function setParam(model: Live2DModel, name: string, value: number): void {
  const coreModel = (model as any).internalModel?.coreModel;
  if (!coreModel) return;
  const idx = coreModel.getParameterIndex?.(name);
  if (idx != null && idx >= 0) {
    coreModel.setParameterValueById?.(name, value);
  }
}

/**
 * Convenience: set multiple params at once.
 */
export function setParams(model: Live2DModel, params: Record<string, number>): void {
  for (const [name, value] of Object.entries(params)) {
    setParam(model, name, value);
  }
}
