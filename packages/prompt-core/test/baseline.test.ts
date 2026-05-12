import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASELINE_DEFAULT_MIN_SAMPLES,
  coldStartState,
  computeDelta,
  loadBaseline,
  refreshBaseline,
} from '../src/baseline.js';
import { insertPromptUsage, openDb, upsertQualityScore, upsertSession } from '../src/db.js';

describe('computeDelta (D-046 §5.2)', () => {
  it('null when baseline is absent (cold-start)', () => {
    expect(computeDelta(80, null)).toBeNull();
  });
  it('null when baseline sample is below min threshold', () => {
    expect(
      computeDelta(80, {
        id: 'b1',
        scope: 'global',
        window_days: 30,
        computed_at: '2026-04-24T00:00:00Z',
        sample_size: 10,
        avg_final_score: 75,
        avg_word_count: 20,
        avg_severity_hits: 1,
      })
    ).toBeNull();
  });
  it('rounds delta to integer when baseline is active', () => {
    expect(
      computeDelta(72, {
        id: 'b1',
        scope: 'global',
        window_days: 30,
        computed_at: '2026-04-24T00:00:00Z',
        sample_size: 60,
        avg_final_score: 78.4,
        avg_word_count: 20,
        avg_severity_hits: 1,
      })
    ).toBe(-6);
  });
});

describe('coldStartState', () => {
  it('marks cold-start when below threshold', () => {
    const s = coldStartState(null, 12);
    expect(s.coldStart).toBe(true);
    expect(s.need).toBe(BASELINE_DEFAULT_MIN_SAMPLES);
    expect(s.have).toBe(12);
  });
  it('clears cold-start when baseline sample >= min', () => {
    const s = coldStartState(
      {
        id: 'b1',
        scope: 'global',
        window_days: 30,
        computed_at: '2026-04-24T00:00:00Z',
        sample_size: 120,
        avg_final_score: 75,
        avg_word_count: 20,
        avg_severity_hits: 1,
      },
      9999
    );
    expect(s.coldStart).toBe(false);
    expect(s.have).toBe(120);
  });
});

describe('refreshBaseline (DB round-trip)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tp-baseline-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when sample size is below minimum', () => {
    const db = openDb(root);
    upsertSession(db, { id: 's1', cwd: '/tmp' });
    const u = insertPromptUsage(db, { session_id: 's1', prompt_text: 'hi' });
    upsertQualityScore(db, {
      usage_id: u.id,
      rule_score: 80,
      usage_score: null,
      judge_score: null,
      final_score: 80,
      tier: 'ok',
      rules_version: 1,
    });
    const snap = refreshBaseline(db, { minSamples: 50 });
    expect(snap).toBeNull();
    expect(loadBaseline(db)).toBeNull();
  });

  it('persists and returns snapshot when enough samples exist', () => {
    const db = openDb(root);
    upsertSession(db, { id: 's1', cwd: '/tmp' });
    for (let i = 0; i < 6; i++) {
      const u = insertPromptUsage(db, { session_id: 's1', prompt_text: `prompt ${i}` });
      upsertQualityScore(db, {
        usage_id: u.id,
        rule_score: 80,
        usage_score: null,
        judge_score: null,
        final_score: 70 + i,
        tier: 'ok',
        rules_version: 1,
      });
    }
    const snap = refreshBaseline(db, { minSamples: 5 });
    expect(snap).not.toBeNull();
    expect(snap!.sample_size).toBe(6);
    expect(snap!.avg_final_score).toBeCloseTo(72.5, 1);
    const loaded = loadBaseline(db);
    expect(loaded?.id).toBe(snap!.id);
  });
});
