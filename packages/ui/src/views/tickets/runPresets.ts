/**
 * Display mirror of core's `TICKET_RUN_PRESETS`.
 *
 * The values are duplicated on purpose: importing a runtime value from the
 * `@claude-alive/core` barrel drags in the Node-only transcript parser and breaks
 * the browser bundle, so the UI takes the TYPE from core and keeps the constants
 * local. These strings are for the form preview only — the authoritative pairing
 * is resolved server-side at creation and comes back on the ticket itself
 * (`requestedModel` / `effort`), which is what the detail view renders.
 *
 * KEEP IN SYNC with core's `TICKET_RUN_PRESETS` / `TICKET_MODEL_LABELS`; the
 * runPresets test asserts the shape so a preset added on one side is caught.
 */
import type { TicketRunPreset } from '@claude-alive/core';

export const RUN_PRESET_IDS: readonly TicketRunPreset[] = ['fast', 'medium', 'standard', 'deep'];

export const DEFAULT_RUN_PRESET: TicketRunPreset = 'standard';

export interface RunPresetPreview {
  /** Exact id passed to `--model`, shown on hover so the flag is never hidden. */
  model: string;
  /** Marketing name of that id — what the picker shows. */
  modelLabel: string;
  effort: string;
}

const OPUS = 'claude-opus-5';
const SONNET = 'claude-sonnet-5';

/** Model id → marketing name, mirroring core's `TICKET_MODEL_LABELS`. */
export const MODEL_LABELS: Readonly<Record<string, string>> = {
  [OPUS]: 'Opus 5',
  [SONNET]: 'Sonnet 5',
};

/** Marketing name for a model id, or the id itself when we have no label. */
export function modelLabel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return MODEL_LABELS[model] ?? model;
}

export const RUN_PRESET_PREVIEW: Record<TicketRunPreset, RunPresetPreview> = {
  fast: { model: SONNET, modelLabel: MODEL_LABELS[SONNET], effort: 'low' },
  medium: { model: OPUS, modelLabel: MODEL_LABELS[OPUS], effort: 'medium' },
  standard: { model: OPUS, modelLabel: MODEL_LABELS[OPUS], effort: 'high' },
  deep: { model: OPUS, modelLabel: MODEL_LABELS[OPUS], effort: 'max' },
};

/** i18n key for a preset's button label. */
export function runPresetLabelKey(id: TicketRunPreset): string {
  return `tickets.preset.${id}`;
}
