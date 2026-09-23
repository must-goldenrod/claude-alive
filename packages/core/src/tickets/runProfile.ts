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
export const TICKET_RUN_PRESET_IDS = ['fast', 'medium', 'standard', 'deep', 'expert', 'ultimate'] as const;
export type TicketRunPreset = (typeof TICKET_RUN_PRESET_IDS)[number];

/**
 * Pinned model ids handed to `--model`. Bump these (and the labels below) when a
 * new generation ships; every preset then moves together and old tickets keep
 * their snapshotted ids.
 */
export const TICKET_MODEL_OPUS = 'claude-opus-5';
export const TICKET_MODEL_SONNET = 'claude-sonnet-5';
export const TICKET_MODEL_FABLE = 'claude-fable-5-1';

/**
 * Current-generation Claude id: `claude-<family>-<major>[-<minor>][-<yyyymmdd>][[…]]`.
 * The optional minor is 1–2 digits so an 8-digit snapshot date is never read as
 * a version. Legacy ids (`claude-3-5-sonnet-…`) put the family last and fall
 * through to the raw id.
 */
const CLAUDE_MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/;

/**
 * Marketing name for a model id (`claude-opus-5-5` → `Opus 5.5`), or the id
 * itself when it is not a Claude id. Derived from the id rather than looked up,
 * so the version shown is always the version that ran — a hand-kept table goes
 * stale on the next release and labels a run with a number it never had.
 */
export function modelDisplayName(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const m = CLAUDE_MODEL_ID.exec(model);
  if (!m) return model;
  const [, family, major, minor] = m;
  const name = family!.charAt(0).toUpperCase() + family!.slice(1);
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`;
}

/** Labels for the pinned ids, derived from the ids themselves. */
export const TICKET_MODEL_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  [TICKET_MODEL_OPUS, TICKET_MODEL_SONNET, TICKET_MODEL_FABLE].map((id) => [id, modelDisplayName(id)!]),
);

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
 * `expert` / `ultimate` sit above `deep` on the larger Fable tier; they spend
 * subscription usage fastest, so a run that hits the limit is reported as
 * `usage-limit` rather than a generic crash (see server `agentQuotaError.ts`).
 */
export const TICKET_RUN_PRESETS: Readonly<Record<TicketRunPreset, TicketRunProfile>> = {
  fast: { model: TICKET_MODEL_SONNET, effort: 'low' },
  medium: { model: TICKET_MODEL_OPUS, effort: 'medium' },
  standard: { model: TICKET_MODEL_OPUS, effort: 'high' },
  deep: { model: TICKET_MODEL_OPUS, effort: 'max' },
  expert: { model: TICKET_MODEL_FABLE, effort: 'medium' },
  ultimate: { model: TICKET_MODEL_FABLE, effort: 'high' },
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
