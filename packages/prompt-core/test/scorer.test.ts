import { describe, expect, it } from 'vitest';
import {
  applyCap,
  capFor,
  composeFinalScore,
  computeEfficiencyScore,
  computeRuleScore,
  computeUsageScore,
  positiveBonus,
  tierFor,
} from '../src/scorer.js';

describe('computeRuleScore', () => {
  it('100 when no hits', () => {
    expect(computeRuleScore([])).toBe(100);
  });
  it('subtracts per severity weight', () => {
    expect(computeRuleScore([{ severity: 3 }])).toBe(90);
    expect(computeRuleScore([{ severity: 3 }, { severity: 2 }])).toBe(85);
    expect(computeRuleScore([{ severity: 5 }, { severity: 5 }, { severity: 5 }])).toBe(10);
  });
  it('floors at 0', () => {
    expect(computeRuleScore(Array(10).fill({ severity: 5 }))).toBe(0);
  });
});

describe('positiveBonus (D-046 §3.3)', () => {
  it('zero when no signals', () => {
    expect(positiveBonus({})).toBe(0);
  });
  it('sums per-signal weights and caps at 10', () => {
    expect(positiveBonus({ hasOutputFormat: true })).toBe(3);
    expect(
      positiveBonus({
        hasOutputFormat: true,
        hasSuccessCriteria: true,
        hasExample: true,
        hasFilePathOrVersion: true,
        wordCount: 80,
      })
    ).toBe(10);
  });
  it('example bonus requires wordCount >= 40', () => {
    expect(positiveBonus({ hasExample: true, wordCount: 10 })).toBe(0);
    expect(positiveBonus({ hasExample: true, wordCount: 40 })).toBe(2);
  });
});

describe('computeEfficiencyScore (D-046 §3.4.1)', () => {
  it('null when no efficiency features present', () => {
    expect(
      computeEfficiencyScore({ toolCalls: 0, toolFails: 0, reuseCount: 0, responseLength: 0 })
    ).toBeNull();
  });
  it('first-shot success dominates', () => {
    const hit = computeEfficiencyScore({
      toolCalls: 0,
      toolFails: 0,
      reuseCount: 0,
      responseLength: 0,
      firstShotSuccess: 1,
      turnToolCallCount: 2,
      followUpDepth: 1,
    })!;
    const miss = computeEfficiencyScore({
      toolCalls: 0,
      toolFails: 0,
      reuseCount: 0,
      responseLength: 0,
      firstShotSuccess: 0,
      turnToolCallCount: 2,
      followUpDepth: 3,
    })!;
    expect(hit).toBeGreaterThan(miss);
    expect(hit).toBeGreaterThanOrEqual(80);
  });
});

describe('computeUsageScore', () => {
  it('null when no signals at all', () => {
    expect(
      computeUsageScore({ toolCalls: 0, toolFails: 0, reuseCount: 0, responseLength: 0 })
    ).toBeNull();
  });
  it('penalizes failure rate', () => {
    const noFail = computeUsageScore({
      toolCalls: 10,
      toolFails: 0,
      reuseCount: 0,
      responseLength: 100,
    });
    const someFail = computeUsageScore({
      toolCalls: 10,
      toolFails: 5,
      reuseCount: 0,
      responseLength: 100,
    });
    expect(noFail).toBeGreaterThan(someFail!);
  });
  it('efficiency rewards a first-shot turn more than a stalled one', () => {
    // Perfect first-shot (zero tool calls, depth 1) → efficiency = 100.
    // Stalled turn (16 tool calls, followUp depth 4, failed first shot) →
    // efficiency drags the score down substantially. The contrast is what
    // the D-046 efficiency axis is designed to surface.
    const firstShot = computeUsageScore({
      toolCalls: 2,
      toolFails: 0,
      reuseCount: 0,
      responseLength: 0,
      firstShotSuccess: 1,
      turnToolCallCount: 0,
      followUpDepth: 1,
    })!;
    const stalled = computeUsageScore({
      toolCalls: 2,
      toolFails: 0,
      reuseCount: 0,
      responseLength: 0,
      firstShotSuccess: 0,
      turnToolCallCount: 16,
      followUpDepth: 4,
    })!;
    expect(firstShot).toBeGreaterThan(stalled);
  });
});

describe('capFor / applyCap (D-046 §3.5 — asymmetric cap)', () => {
  it('severity 5 caps at 40', () => {
    expect(capFor({ maxSeverity: 5, severity3Count: 0 })).toBe(40);
    expect(applyCap(95, { maxSeverity: 5, severity3Count: 0 })).toEqual({ score: 40, cap: 40 });
  });
  it('severity 4 caps at 60', () => {
    expect(capFor({ maxSeverity: 4, severity3Count: 0 })).toBe(60);
    expect(applyCap(95, { maxSeverity: 4, severity3Count: 0 }).score).toBe(60);
  });
  it('two severity-3 hits cap at 75', () => {
    expect(capFor({ maxSeverity: 3, severity3Count: 2 })).toBe(75);
    expect(applyCap(90, { maxSeverity: 3, severity3Count: 2 }).score).toBe(75);
  });
  it('below cap passes through unchanged', () => {
    expect(applyCap(55, { maxSeverity: 3, severity3Count: 1 })).toEqual({ score: 55, cap: 100 });
  });
});

describe('composeFinalScore (D-046)', () => {
  it('uses rule_score when no other signals', () => {
    expect(
      composeFinalScore({ rule_score: 80, usage_score: null, judge_score: null })
    ).toMatchObject({
      final_score: 80,
      tier: 'ok',
    });
  });
  it('mixes rule + usage', () => {
    const r = composeFinalScore({ rule_score: 80, usage_score: 60, judge_score: null });
    expect(r.final_score).toBe(Math.round(0.7 * 80 + 0.3 * 60));
  });
  it('includes judge when present', () => {
    const r = composeFinalScore({ rule_score: 80, usage_score: 60, judge_score: 70 });
    expect(r.final_score).toBe(Math.round(0.5 * 80 + 0.3 * 60 + 0.2 * 70));
  });
  it('adds bonus then caps at 100', () => {
    const r = composeFinalScore({
      rule_score: 96,
      usage_score: null,
      judge_score: null,
      bonus: 10,
    });
    expect(r.final_score).toBe(100);
    expect(r.bonus).toBe(10);
  });
  it('severity-5 cap overrides otherwise-perfect score', () => {
    // Rule score stays at 70 (one severity-5 hit -30), usage_score high, but cap=40.
    const r = composeFinalScore({
      rule_score: 70,
      usage_score: 95,
      judge_score: null,
      bonus: 5,
      maxSeverity: 5,
      severity3Count: 0,
    });
    expect(r.final_score).toBeLessThanOrEqual(40);
    expect(r.tier).toBe('bad');
    expect(r.cap).toBe(40);
  });
  it('positive bonus lifts a clean prompt into good tier', () => {
    // Clean rule (100) + null usage + bonus 8 → 100, good.
    const r = composeFinalScore({
      rule_score: 100,
      usage_score: null,
      judge_score: null,
      bonus: 8,
    });
    expect(r.tier).toBe('good');
  });
});

describe('tierFor (D-046 bands 90/70/50)', () => {
  it('maps to new bands', () => {
    expect(tierFor(95)).toBe('good');
    expect(tierFor(90)).toBe('good');
    expect(tierFor(89)).toBe('ok');
    expect(tierFor(70)).toBe('ok');
    expect(tierFor(69)).toBe('weak');
    expect(tierFor(50)).toBe('weak');
    expect(tierFor(49)).toBe('bad');
    expect(tierFor(0)).toBe('bad');
  });
});
