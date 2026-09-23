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

export const RUN_PRESET_IDS: readonly TicketRunPreset[] = ['fast', 'medium', 'standard', 'deep', 'expert', 'ultimate'];

export const DEFAULT_RUN_PRESET: TicketRunPreset = 'standard';

export interface RunPresetPreview {
  /** Exact id passed to `--model`, shown on hover so the flag is never hidden. */
  model: string;
  /** Marketing name of that id — what the picker shows. */
  modelLabel: string;
  effort: string;
}

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5';
const FABLE = 'claude-fable-5-1';

/** Mirror of core's `CLAUDE_MODEL_ID` — see `modelDisplayName` there. */
const CLAUDE_MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/;

/** Marketing name for a model id (`claude-opus-5-5` → `Opus 5.5`), or the id itself. */
export function modelLabel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const m = CLAUDE_MODEL_ID.exec(model);
  if (!m) return model;
  const [, family, major, minor] = m;
  const name = family!.charAt(0).toUpperCase() + family!.slice(1);
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`;
}

/**
 * Name plus exact id (`Opus 5.5 (claude-opus-5-5)`) for record views, where the id
 * that ran must stay visible. Non-Claude ids have no separate name and show once.
 */
export function modelLabelWithId(model: string): string {
  const label = modelLabel(model);
  return label && label !== model ? `${label} (${model})` : model;
}

/** Model id → marketing name, mirroring core's `TICKET_MODEL_LABELS`. */
export const MODEL_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  [OPUS, SONNET, FABLE].map((id) => [id, modelLabel(id)!]),
);

export const RUN_PRESET_PREVIEW: Record<TicketRunPreset, RunPresetPreview> = {
  fast: { model: SONNET, modelLabel: MODEL_LABELS[SONNET]!, effort: 'low' },
  medium: { model: OPUS, modelLabel: MODEL_LABELS[OPUS]!, effort: 'medium' },
  standard: { model: OPUS, modelLabel: MODEL_LABELS[OPUS]!, effort: 'high' },
  deep: { model: OPUS, modelLabel: MODEL_LABELS[OPUS]!, effort: 'max' },
  expert: { model: FABLE, modelLabel: MODEL_LABELS[FABLE]!, effort: 'medium' },
  ultimate: { model: FABLE, modelLabel: MODEL_LABELS[FABLE]!, effort: 'high' },
};

/** i18n key for a preset's button label. */
export function runPresetLabelKey(id: TicketRunPreset): string {
  return `tickets.preset.${id}`;
}
