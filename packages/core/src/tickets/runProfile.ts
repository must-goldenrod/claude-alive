/**
 * Ticket run profiles — which model and reasoning effort a ticket's agent runs with.
 *
 * The UI exposes three presets rather than free-form model×effort combinations:
 * the combination space is large, most of it is not useful, and a bad pairing
 * (cheap model + max effort) wastes tokens without improving the result. A preset
 * is resolved to a concrete `{model, effort}` at creation time and that resolution
 * is SNAPSHOTTED onto the ticket — so redefining a preset later never rewrites the
 * history of what already ran.
 *
 * `model` is a PINNED full model id, not a moving alias ('opus', 'sonnet'). An
 * alias would make the version the picker advertises a guess — the CLI could
 * resolve it to a newer generation than the label claims, and the ticket history
 * would record a run condition nobody chose. Pinning costs one edit per model
 * release and buys "what the button said is what ran". The version that actually
 * served the run is still captured separately from the result stream
 * (`Ticket.model`), which is what surfaces a mismatch if one ever happens.
 */

/** Reasoning effort levels accepted by `claude --effort`. */
export const TICKET_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type TicketEffort = (typeof TICKET_EFFORT_LEVELS)[number];

/** Selectable run presets, cheapest first — the picker reads as a cost ramp. */
export const TICKET_RUN_PRESET_IDS = ['fast', 'medium', 'standard', 'deep'] as const;
export type TicketRunPreset = (typeof TICKET_RUN_PRESET_IDS)[number];

/**
 * Pinned model ids handed to `--model`. Bump these (and the labels below) when a
 * new generation ships; every preset then moves together and old tickets keep
 * their snapshotted ids.
 */
export const TICKET_MODEL_OPUS = 'claude-opus-5';
export const TICKET_MODEL_SONNET = 'claude-sonnet-5';

/**
 * Human-facing names for the pinned ids. Only ids we pin are listed — a run can
 * report a model from a remote host on a different build, and showing that raw
 * id is more honest than inventing a name for it.
 */
export const TICKET_MODEL_LABELS: Readonly<Record<string, string>> = {
  [TICKET_MODEL_OPUS]: 'Opus 5',
  [TICKET_MODEL_SONNET]: 'Sonnet 5',
};

/** Marketing name for a model id, or the id itself when we have no label. */
export function modelDisplayName(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return TICKET_MODEL_LABELS[model] ?? model;
}

/** A preset resolved to the concrete flags handed to the agent CLI. */
export interface TicketRunProfile {
  /** Model alias or full id for `--model`. */
  model: string;
  /** Reasoning effort for `--effort`. */
  effort: TicketEffort;
}

/**
 * Preset → flags. `standard` intentionally mirrors the previous implicit
 * behaviour (the global `effortLevel: high` default), so existing tickets and
 * new default-preset tickets stay comparable in the usage dashboard. `medium`
 * sits between the Sonnet tier and `standard`: same model as `standard`, one
 * effort step down, for work that needs Opus reasoning but not high effort.
 */
export const TICKET_RUN_PRESETS: Readonly<Record<TicketRunPreset, TicketRunProfile>> = {
  fast: { model: TICKET_MODEL_SONNET, effort: 'low' },
  medium: { model: TICKET_MODEL_OPUS, effort: 'medium' },
  standard: { model: TICKET_MODEL_OPUS, effort: 'high' },
  deep: { model: TICKET_MODEL_OPUS, effort: 'max' },
};

export const DEFAULT_TICKET_RUN_PRESET: TicketRunPreset = 'standard';

export function isTicketRunPreset(value: unknown): value is TicketRunPreset {
  return typeof value === 'string' && (TICKET_RUN_PRESET_IDS as readonly string[]).includes(value);
}

export function isTicketEffort(value: unknown): value is TicketEffort {
  return typeof value === 'string' && (TICKET_EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Resolve a preset id to its flags. Returns undefined for an unknown id so the
 * caller falls back to the CLI's own defaults rather than guessing — an unknown
 * preset must never silently become an expensive one.
 */
export function resolveRunProfile(preset: string | undefined): TicketRunProfile | undefined {
  if (!isTicketRunPreset(preset)) return undefined;
  return TICKET_RUN_PRESETS[preset];
}
