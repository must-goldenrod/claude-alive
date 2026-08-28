import { describe, it, expect } from 'vitest';
import {
  resolveRunProfile,
  isTicketRunPreset,
  isTicketEffort,
  modelDisplayName,
  TICKET_RUN_PRESETS,
  TICKET_RUN_PRESET_IDS,
  TICKET_EFFORT_LEVELS,
  DEFAULT_TICKET_RUN_PRESET,
} from '../tickets/runProfile.js';

describe('resolveRunProfile', () => {
  it('resolves each preset to concrete flags', () => {
    expect(resolveRunProfile('fast')).toEqual({ model: 'claude-sonnet-5', effort: 'low' });
    expect(resolveRunProfile('medium')).toEqual({ model: 'claude-opus-5', effort: 'medium' });
    expect(resolveRunProfile('standard')).toEqual({ model: 'claude-opus-5', effort: 'high' });
    expect(resolveRunProfile('deep')).toEqual({ model: 'claude-opus-5', effort: 'max' });
  });

  it('pins a full model id, never a moving alias', () => {
    // An alias ('opus') would make the version shown in the UI a guess: the run
    // could be served by a newer generation than the label claims.
    for (const id of TICKET_RUN_PRESET_IDS) {
      expect(TICKET_RUN_PRESETS[id].model).toMatch(/^claude-[a-z]+-\d/);
    }
  });

  it('orders presets cheapest-first so the picker reads as a cost ramp', () => {
    expect(TICKET_RUN_PRESET_IDS).toEqual(['fast', 'medium', 'standard', 'deep']);
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
    expect(isTicketRunPreset('medium')).toBe(true);
    expect(isTicketRunPreset('DEEP')).toBe(false);
    expect(isTicketRunPreset(null)).toBe(false);
    expect(isTicketEffort('xhigh')).toBe(true);
    expect(isTicketEffort('extreme')).toBe(false);
    expect(isTicketEffort(3)).toBe(false);
  });
});

describe('modelDisplayName', () => {
  it('renders pinned ids as their marketing name', () => {
    expect(modelDisplayName('claude-opus-5')).toBe('Opus 5');
    expect(modelDisplayName('claude-sonnet-5')).toBe('Sonnet 5');
  });

  it('passes unknown ids through untouched', () => {
    // A run can report a model we have no label for (a remote host on a
    // different build). Showing the raw id beats inventing a name.
    expect(modelDisplayName('claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(modelDisplayName(undefined)).toBeUndefined();
  });

  it('has a label for every model a preset can request', () => {
    for (const id of TICKET_RUN_PRESET_IDS) {
      const model = TICKET_RUN_PRESETS[id].model;
      expect(modelDisplayName(model)).not.toBe(model);
    }
  });
});
