/**
 * Display mirror of core's `TICKET_RUN_PRESETS`.
 *
 * The values are duplicated on purpose: importing a runtime value from the
 * `@claude-alive/core` barrel drags in the Node-only transcript parser and breaks
 * the browser bundle, so the UI takes the TYPE from core and keeps the constants
 * local. These strings are for the form preview only — the authoritative pairing
 * is resolved server-side at creation and comes back on the ticket itself
 * (`requestedModel` / `effort`), which is what the detail view renders.
 */
import type { TicketRunPreset } from '@claude-alive/core';

export const RUN_PRESET_IDS: readonly TicketRunPreset[] = ['fast', 'standard', 'deep'];

export const DEFAULT_RUN_PRESET: TicketRunPreset = 'standard';

export interface RunPresetPreview {
  model: string;
  effort: string;
}

export const RUN_PRESET_PREVIEW: Record<TicketRunPreset, RunPresetPreview> = {
  fast: { model: 'sonnet', effort: 'low' },
  standard: { model: 'opus', effort: 'high' },
  deep: { model: 'opus', effort: 'max' },
};

/** i18n key for a preset's button label. */
export function runPresetLabelKey(id: TicketRunPreset): string {
  return `tickets.preset.${id}`;
}
