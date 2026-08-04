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
 * `model` uses the CLI's moving alias ('opus', 'sonnet') so tickets follow the
 * latest release; the exact version that actually served the run is captured
 * separately from the result stream (`Ticket.model`).
 */

/** Reasoning effort levels accepted by `claude --effort`. */
export const TICKET_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type TicketEffort = (typeof TICKET_EFFORT_LEVELS)[number];

/** Selectable run presets, cheapest first. */
export const TICKET_RUN_PRESET_IDS = ['fast', 'standard', 'deep'] as const;
export type TicketRunPreset = (typeof TICKET_RUN_PRESET_IDS)[number];

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
 * new default-preset tickets stay comparable in the usage dashboard.
 */
export const TICKET_RUN_PRESETS: Readonly<Record<TicketRunPreset, TicketRunProfile>> = {
  fast: { model: 'sonnet', effort: 'low' },
  standard: { model: 'opus', effort: 'high' },
  deep: { model: 'opus', effort: 'max' },
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
