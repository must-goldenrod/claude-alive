/**
 * Agent engine — which model API the `claude` CLI talks to.
 *
 * `claude` is the default: the CLI uses the user's own Claude login. `gateway`
 * keeps the same CLI (hooks, tools, sessions, the whole ticket lifecycle) but
 * points it at the OpenAI/Anthropic-compatible LLM gateway configured in
 * Settings → Backend, so a run is served by a gateway model such as glm-5.3.
 *
 * The engine is chosen once in Settings and SNAPSHOTTED onto each ticket at
 * creation, like the model id. A session served by one engine must be resumed
 * by the same engine: gateway models return thinking blocks without an
 * Anthropic signature, which the Claude API would reject on a resumed turn.
 */
import { TICKET_RUN_PRESET_IDS, type TicketRunPreset } from './runProfile.js';

export const TICKET_ENGINES = ['claude', 'gateway'] as const;
export type TicketEngine = (typeof TICKET_ENGINES)[number];

/** Gateway model per run preset. Effort still comes from the preset itself. */
export type GatewayPresetModels = Readonly<Record<TicketRunPreset, string>>;

export interface EngineSettings {
  engine: TicketEngine;
  presetModels: GatewayPresetModels;
}

export const GATEWAY_MODEL_MAIN = 'glm-5.3';
export const GATEWAY_MODEL_FAST = 'glm-5.3-flash';

export const DEFAULT_GATEWAY_PRESET_MODELS: GatewayPresetModels = Object.freeze({
  fast: GATEWAY_MODEL_FAST,
  medium: GATEWAY_MODEL_MAIN,
  standard: GATEWAY_MODEL_MAIN,
  deep: GATEWAY_MODEL_MAIN,
  expert: GATEWAY_MODEL_MAIN,
  ultimate: GATEWAY_MODEL_MAIN,
});

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = Object.freeze({
  engine: 'claude',
  presetModels: DEFAULT_GATEWAY_PRESET_MODELS,
});

/**
 * Model ids become CLI argv (and, for SSH tickets, part of a remote command), so
 * only the characters real gateway ids use are accepted: `glm-5.3`,
 * `gemini/gemini-3.7-flash`, `vendor:model@rev`.
 */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,127}$/;

export function isValidGatewayModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID_PATTERN.test(value);
}

export function isTicketEngine(value: unknown): value is TicketEngine {
  return typeof value === 'string' && (TICKET_ENGINES as readonly string[]).includes(value);
}

/**
 * Normalise stored/posted settings. Unknown engines fall back to `claude` and a
 * missing or invalid preset model falls back to its default, so a hand-edited
 * file can never produce an empty or unsafe `--model`.
 */
export function normalizeEngineSettings(raw: unknown): EngineSettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const models = obj.presetModels && typeof obj.presetModels === 'object'
    ? (obj.presetModels as Record<string, unknown>)
    : {};
  const presetModels = Object.fromEntries(
    TICKET_RUN_PRESET_IDS.map((id) => {
      const value = typeof models[id] === 'string' ? (models[id] as string).trim() : '';
      return [id, isValidGatewayModelId(value) ? value : DEFAULT_GATEWAY_PRESET_MODELS[id]];
    }),
  ) as Record<TicketRunPreset, string>;
  return {
    engine: isTicketEngine(obj.engine) ? obj.engine : 'claude',
    presetModels: Object.freeze(presetModels),
  };
}

/**
 * The gateway model a new ticket runs with: an explicit, valid pick wins, then
 * the preset's mapped model, then the `standard` mapping for a preset-less ticket.
 */
export function resolveGatewayModel(
  settings: EngineSettings,
  preset: TicketRunPreset | undefined,
  explicitModel?: string,
): string {
  const picked = explicitModel?.trim();
  if (picked && isValidGatewayModelId(picked)) return picked;
  return settings.presetModels[preset ?? 'standard'];
}
