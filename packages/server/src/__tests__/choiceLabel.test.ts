import { describe, it, expect } from 'vitest';
import { normalizeChoice } from '../panel/choiceLabel.js';

describe('normalizeChoice', () => {
  it('reads the same option through Korean, English and circled forms', () => {
    // Observed on ticket #279 (옵션1 / OPTION1) and #297 (2 / ②).
    expect(normalizeChoice('옵션1')).toBe('1');
    expect(normalizeChoice('OPTION1')).toBe('1');
    expect(normalizeChoice('Option 1')).toBe('1');
    expect(normalizeChoice('②')).toBe('2');
    expect(normalizeChoice('2')).toBe('2');
    expect(normalizeChoice('2번')).toBe('2');
    expect(normalizeChoice('１')).toBe('1');
  });

  it('ignores punctuation and spacing in a compound label', () => {
    // Observed on ticket #300: two advisors gave the identical answer.
    expect(normalizeChoice('R-1:(A), R-7:(A)')).toBe(normalizeChoice('R-1: A, R-7: A'));
  });

  it('keeps genuinely different options apart', () => {
    expect(normalizeChoice('①')).not.toBe(normalizeChoice('②'));
    expect(normalizeChoice('PROCEED')).not.toBe(normalizeChoice('ABORT'));
  });

  it('does not eat Korean words that merely start with an option word', () => {
    expect(normalizeChoice('안전한 쪽')).toBe('안전한쪽');
  });

  it('returns empty for a label that names nothing', () => {
    expect(normalizeChoice('-')).toBe('');
    expect(normalizeChoice('?')).toBe('');
  });
});
