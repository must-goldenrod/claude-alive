import { describe, it, expect } from 'vitest';
import {
  RUN_PRESET_IDS,
  RUN_PRESET_PREVIEW,
  DEFAULT_RUN_PRESET,
  MODEL_LABELS,
  modelLabel,
} from '../views/tickets/runPresets.ts';
// Imported by source path on purpose: core's package exports expose only the
// barrel, and importing that here would pull in the Node-only transcript parser.
// `runProfile.ts` is plain constants, so reaching for the file directly is safe
// and lets this test compare the UI mirror against the real table — which is the
// whole point: a mirror that silently drifts shows a model the run never used.
import {
  TICKET_RUN_PRESET_IDS,
  TICKET_RUN_PRESETS,
  TICKET_MODEL_LABELS,
  DEFAULT_TICKET_RUN_PRESET,
  modelDisplayName,
} from '../../../core/src/tickets/runProfile.ts';

describe('run preset mirror', () => {
  it('lists the same presets in the same order as core', () => {
    expect(RUN_PRESET_IDS).toEqual([...TICKET_RUN_PRESET_IDS]);
  });

  it('uses the same default preset as core', () => {
    expect(DEFAULT_RUN_PRESET).toBe(DEFAULT_TICKET_RUN_PRESET);
  });

  it('previews the exact model id and effort each preset actually runs with', () => {
    for (const id of TICKET_RUN_PRESET_IDS) {
      const preview = RUN_PRESET_PREVIEW[id];
      expect(preview.model).toBe(TICKET_RUN_PRESETS[id].model);
      expect(preview.effort).toBe(TICKET_RUN_PRESETS[id].effort);
    }
  });

  it('labels every previewed model with core’s marketing name', () => {
    for (const id of TICKET_RUN_PRESET_IDS) {
      const preview = RUN_PRESET_PREVIEW[id];
      expect(preview.modelLabel).toBe(modelDisplayName(preview.model));
      // A label that fell back to the raw id would put 'claude-opus-5' on the
      // button — readable, but not what the picker promises.
      expect(preview.modelLabel).not.toBe(preview.model);
    }
  });

  it('mirrors core’s label table', () => {
    expect(MODEL_LABELS).toEqual(TICKET_MODEL_LABELS);
  });
});

describe('modelLabel', () => {
  it('renders pinned ids as their marketing name', () => {
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5');
  });

  it('passes unknown ids and empty input through', () => {
    expect(modelLabel('claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(modelLabel(undefined)).toBeUndefined();
    expect(modelLabel('')).toBeUndefined();
  });
});
