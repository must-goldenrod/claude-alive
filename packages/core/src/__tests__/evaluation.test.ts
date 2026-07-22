import { describe, it, expect } from 'vitest';
import { seedAutoLabel, clampWeight, DEFAULT_EVAL_WEIGHT } from '../tickets/evaluation.js';
import type { Ticket } from '../tickets/types.js';

function ticket(partial: Partial<Ticket>): Pick<Ticket, 'state' | 'verification'> {
  return { state: 'done', ...partial } as Ticket;
}

describe('seedAutoLabel', () => {
  it('labels a passed, done ticket good', () => {
    expect(seedAutoLabel(ticket({ state: 'done', verification: { passed: true, reason: 'ok' } }))).toBe('good');
  });

  it('labels a failed ticket bad regardless of verification', () => {
    expect(seedAutoLabel(ticket({ state: 'failed' }))).toBe('bad');
    expect(seedAutoLabel(ticket({ state: 'failed', verification: { passed: true, reason: 'x' } }))).toBe('bad');
  });

  it('labels a done ticket without a passing verdict unrated', () => {
    expect(seedAutoLabel(ticket({ state: 'done' }))).toBe('unrated');
    expect(seedAutoLabel(ticket({ state: 'done', verification: { passed: false, reason: 'no' } }))).toBe('unrated');
  });

  it('labels still-active tickets unrated', () => {
    expect(seedAutoLabel(ticket({ state: 'running' }))).toBe('unrated');
    expect(seedAutoLabel(ticket({ state: 'queued' }))).toBe('unrated');
  });
});

describe('clampWeight', () => {
  it('clamps into the 1..5 range', () => {
    expect(clampWeight(0)).toBe(1);
    expect(clampWeight(9)).toBe(5);
    expect(clampWeight(3)).toBe(3);
  });

  it('rounds fractional weights', () => {
    expect(clampWeight(2.4)).toBe(2);
    expect(clampWeight(4.6)).toBe(5);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampWeight(NaN)).toBe(DEFAULT_EVAL_WEIGHT);
    expect(clampWeight(Infinity)).toBe(DEFAULT_EVAL_WEIGHT);
    expect(clampWeight(-Infinity)).toBe(DEFAULT_EVAL_WEIGHT);
  });
});
