import { describe, it, expect } from 'vitest';
import { rateFor, costOf, normalizeModel } from '../modelPricing.js';

describe('normalizeModel', () => {
  it('strips a [context] suffix and provider prefix', () => {
    expect(normalizeModel('claude-opus-4-8[1m]')).toBe('claude-opus-4-8');
    expect(normalizeModel('gemini/gemini-2.5-flash-lite')).toBe('gemini-2.5-flash-lite');
  });
});

describe('rateFor', () => {
  it('prices Opus 4.8 at $5/$25 per MTok (not the legacy $15/$75)', () => {
    const r = rateFor('claude-opus-4-8')!;
    expect(r.input).toBe(5e-6);
    expect(r.output).toBe(25e-6);
    expect(r.cacheRead).toBe(5e-7);
  });

  it('resolves a [context]-suffixed model id', () => {
    expect(rateFor('claude-opus-4-8[1m]')).toEqual(rateFor('claude-opus-4-8'));
  });

  it('falls back by family for an unlisted opus 4.9', () => {
    expect(rateFor('claude-opus-4-9')).toEqual(rateFor('claude-opus-4-8'));
  });

  it('returns null for an unknown model', () => {
    expect(rateFor('<synthetic>')).toBeNull();
  });
});

describe('costOf', () => {
  it('sums the four token classes at per-model rates', () => {
    // input 1M @ $5, output 1M @ $25, cacheWrite 1M @ $6.25, cacheRead 1M @ $0.5
    const cost = costOf(
      { input: 1e6, output: 1e6, cacheCreation: 1e6, cacheRead: 1e6 },
      'claude-opus-4-8',
    );
    expect(cost).toBeCloseTo(5 + 25 + 6.25 + 0.5, 6);
  });

  it('costs cache_creation as ONE bucket (no 1h/5m split)', () => {
    const cost = costOf({ input: 0, output: 0, cacheCreation: 2e6, cacheRead: 0 }, 'claude-opus-4-8');
    expect(cost).toBeCloseTo(12.5, 6); // 2M × $6.25
  });

  it('returns 0 for unknown models', () => {
    expect(costOf({ input: 1e6, output: 1e6, cacheCreation: 0, cacheRead: 0 }, '<synthetic>')).toBe(0);
  });
});
