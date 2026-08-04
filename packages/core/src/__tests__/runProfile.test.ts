import { describe, it, expect } from 'vitest';
import {
  resolveRunProfile,
  isTicketRunPreset,
  isTicketEffort,
  TICKET_RUN_PRESETS,
  TICKET_RUN_PRESET_IDS,
  TICKET_EFFORT_LEVELS,
  DEFAULT_TICKET_RUN_PRESET,
} from '../tickets/runProfile.js';

describe('resolveRunProfile', () => {
  it('resolves each preset to concrete flags', () => {
    expect(resolveRunProfile('fast')).toEqual({ model: 'sonnet', effort: 'low' });
    expect(resolveRunProfile('standard')).toEqual({ model: 'opus', effort: 'high' });
    expect(resolveRunProfile('deep')).toEqual({ model: 'opus', effort: 'max' });
  });

  it('returns undefined for an unknown or absent preset (falls back to CLI defaults)', () => {
    expect(resolveRunProfile(undefined)).toBeUndefined();
    expect(resolveRunProfile('turbo')).toBeUndefined();
    expect(resolveRunProfile('')).toBeUndefined();
  });

  it('only emits effort levels the CLI accepts', () => {
    for (const id of TICKET_RUN_PRESET_IDS) {
      expect(TICKET_EFFORT_LEVELS).toContain(TICKET_RUN_PRESETS[id].effort);
    }
  });

  it('has a default preset that is itself a valid preset', () => {
    expect(isTicketRunPreset(DEFAULT_TICKET_RUN_PRESET)).toBe(true);
  });
});

describe('guards', () => {
  it('accepts known values and rejects everything else', () => {
    expect(isTicketRunPreset('deep')).toBe(true);
    expect(isTicketRunPreset('DEEP')).toBe(false);
    expect(isTicketRunPreset(null)).toBe(false);
    expect(isTicketEffort('xhigh')).toBe(true);
    expect(isTicketEffort('extreme')).toBe(false);
    expect(isTicketEffort(3)).toBe(false);
  });
});
