/**
 * Per-user rolling baseline (D-046 §5).
 *
 * Phase 3 of D-046. The snapshot is stored in `user_baseline_snapshots`
 * (MIGRATION_006). Activation threshold is 50 turns in the window — below
 * that we return null and the dashboard renders a "calibrating…" banner.
 *
 * Thin wrappers around db.ts helpers + a pure `computeDelta` for testing.
 */
import type { Database as Db } from 'better-sqlite3';
import { type BaselineSnapshotRow, getLatestBaseline, recomputeBaseline } from './db.js';

export const BASELINE_DEFAULT_WINDOW_DAYS = 30;
export const BASELINE_DEFAULT_MIN_SAMPLES = 50;

export interface BaselineOpts {
  scope?: string;
  windowDays?: number;
  minSamples?: number;
}

export function refreshBaseline(db: Db, opts: BaselineOpts = {}): BaselineSnapshotRow | null {
  return recomputeBaseline(db, {
    scope: opts.scope ?? 'global',
    windowDays: opts.windowDays ?? BASELINE_DEFAULT_WINDOW_DAYS,
    minSamples: opts.minSamples ?? BASELINE_DEFAULT_MIN_SAMPLES,
  });
}

export function loadBaseline(db: Db, scope = 'global'): BaselineSnapshotRow | null {
  return getLatestBaseline(db, scope);
}

/**
 * Pure delta computation. Returns null when baseline is absent — callers
 * MUST treat null as "cold start, do not display delta".
 */
export function computeDelta(
  finalScore: number,
  baseline: BaselineSnapshotRow | null
): number | null {
  if (!baseline) return null;
  if (baseline.sample_size < BASELINE_DEFAULT_MIN_SAMPLES) return null;
  return Math.round(finalScore - baseline.avg_final_score);
}

/**
 * Convenience: returns both whether cold-start is still active and the
 * sample-size progress, so the UI can show "N / 50" during warm-up.
 */
export function coldStartState(
  baseline: BaselineSnapshotRow | null,
  currentSampleSize: number,
  minSamples = BASELINE_DEFAULT_MIN_SAMPLES
): { coldStart: boolean; have: number; need: number } {
  const have = baseline?.sample_size ?? currentSampleSize;
  return { coldStart: have < minSamples, have, need: minSamples };
}
