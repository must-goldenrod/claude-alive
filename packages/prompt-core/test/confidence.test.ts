import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE_DELTA, computeConfidence } from '../src/confidence.js';

describe('computeConfidence (D-046 §6)', () => {
  it('low when context is marked unusual', () => {
    expect(
      computeConfidence({
        maxSeverity: 3,
        hasUsageScore: true,
        hasJudgeScore: true,
        contextUnusual: true,
      })
    ).toBe('low');
  });

  it('low when baseline delta is extreme', () => {
    expect(
      computeConfidence({
        maxSeverity: 0,
        hasUsageScore: true,
        hasJudgeScore: false,
        baselineDelta: LOW_CONFIDENCE_DELTA + 5,
      })
    ).toBe('low');
  });

  it('low when only weak rule signals and no usage/judge', () => {
    expect(
      computeConfidence({
        maxSeverity: 1,
        hasUsageScore: false,
        hasJudgeScore: false,
      })
    ).toBe('low');
  });

  it('high when severe rule hit + supporting usage signal', () => {
    expect(
      computeConfidence({
        maxSeverity: 4,
        hasUsageScore: true,
        hasJudgeScore: false,
      })
    ).toBe('high');
  });

  it('high when clean rule and usage confirms', () => {
    expect(
      computeConfidence({
        maxSeverity: 0,
        hasUsageScore: true,
        hasJudgeScore: false,
      })
    ).toBe('high');
  });

  it('medium is the default middle ground', () => {
    expect(
      computeConfidence({
        maxSeverity: 2,
        hasUsageScore: false,
        hasJudgeScore: false,
      })
    ).toBe('medium');
  });
});
