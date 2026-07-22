import { describe, it, expect } from 'vitest';
import type { TicketEvaluation } from '@claude-alive/core';
import { synthesizeGuide } from '../guideSynthesizer.js';

function ev(over: Partial<TicketEvaluation>): TicketEvaluation {
  return {
    ticketId: 'x',
    seq: 1,
    route: '/proj/a',
    goal: 'goal',
    autoLabel: 'unrated',
    label: 'unrated',
    humanLabeled: false,
    weight: 3,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('synthesizeGuide', () => {
  it('returns empty text when nothing is labelled', () => {
    const g = synthesizeGuide('/proj/a', [ev({}), ev({ label: 'unrated' })], 100);
    expect(g.text).toBe('');
    expect(g.goodCount).toBe(0);
    expect(g.badCount).toBe(0);
    expect(g.updatedAt).toBe(100);
  });

  it('renders good as Do and bad as Avoid', () => {
    const g = synthesizeGuide('/proj/a', [
      ev({ ticketId: 'a', label: 'good', goal: 'add tests', headline: 'coverage 92%' }),
      ev({ ticketId: 'b', label: 'bad', goal: 'refactor auth', failureReason: 'verification-failed' }),
    ], 1);
    expect(g.goodCount).toBe(1);
    expect(g.badCount).toBe(1);
    expect(g.text).toContain('add tests');
    expect(g.text).toContain('coverage 92%');
    expect(g.text).toContain('refactor auth');
    expect(g.text).toContain('verification-failed');
    expect(g.text.indexOf('add tests')).toBeLessThan(g.text.indexOf('refactor auth'));
  });

  it('orders good exemplars by weight (strongest first) and caps at 2', () => {
    const g = synthesizeGuide('/proj/a', [
      ev({ ticketId: 'a', label: 'good', goal: 'low', weight: 1 }),
      ev({ ticketId: 'b', label: 'good', goal: 'high', weight: 5 }),
      ev({ ticketId: 'c', label: 'good', goal: 'mid', weight: 3 }),
    ], 1);
    expect(g.goodCount).toBe(3);
    expect(g.text.indexOf('high')).toBeLessThan(g.text.indexOf('mid'));
    expect(g.text).not.toContain('low'); // capped at 2, weakest dropped
  });

  it('prefers a human note over the failure reason for bad exemplars', () => {
    const g = synthesizeGuide('/proj/a', [
      ev({ label: 'bad', goal: 'g', failureReason: 'error', note: 'left debug logs' }),
    ], 1);
    expect(g.text).toContain('left debug logs');
    expect(g.text).not.toContain('→ error');
  });

  it('caps total text length', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      ev({ ticketId: `g${i}`, label: 'good', goal: 'x'.repeat(500), weight: 5 - i }),
    );
    const g = synthesizeGuide('/proj/a', many, 1);
    expect(g.text.length).toBeLessThanOrEqual(800);
  });
});
