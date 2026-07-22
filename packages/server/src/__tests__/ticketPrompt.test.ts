import { describe, it, expect } from 'vitest';
import { buildMainPrompt, HEADLINE_INSTRUCTION } from '../ticketPrompt.js';

describe('buildMainPrompt', () => {
  it('appends the HEADLINE instruction to the goal', () => {
    const out = buildMainPrompt('do the thing');
    expect(out).toBe(`do the thing${HEADLINE_INSTRUCTION}`);
  });

  it('is byte-identical to the goal+suffix when no guide is given', () => {
    expect(buildMainPrompt('g', '')).toBe(buildMainPrompt('g'));
    expect(buildMainPrompt('g', '   ')).toBe(buildMainPrompt('g'));
  });

  it('prepends the guide before the goal when present', () => {
    const out = buildMainPrompt('refactor', 'Learned: prefer X');
    expect(out.startsWith('Learned: prefer X\n\n---\nrefactor')).toBe(true);
    expect(out.endsWith(HEADLINE_INSTRUCTION)).toBe(true);
  });
});
