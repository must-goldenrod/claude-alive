/**
 * Agent engine settings (Settings → Backend → Engine).
 *
 * Chooses whether new tickets and Claude terminals run the `claude` CLI against
 * the user's Claude login or against the LLM gateway, and which gateway model
 * each run preset maps to. Stored in `~/.claude-alive/engine.json`, held in
 * memory, and read at every spawn — so a save applies to the next ticket or
 * terminal without a restart. Tickets snapshot the engine at creation (see
 * core `tickets/engine.ts`), so a running or resumed ticket never switches.
 */
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ENGINE_SETTINGS,
  TICKET_RUN_PRESET_IDS,
  isTicketEngine,
  isValidGatewayModelId,
  normalizeEngineSettings,
  writePrivateFile,
  type EngineSettings,
} from '@claude-alive/core';

/** Bad user input; the HTTP layer maps it to 400. */
export class EngineSettingsValidationError extends Error {
  readonly name = 'EngineSettingsValidationError';
}

export interface EngineSettingsDeps {
  file: string;
  /** Whether a gateway is configured right now; switching to it requires one. */
  gatewayConfigured: () => boolean;
  /** Called after a successful save (broadcast to dashboards). */
  onChange?: (settings: EngineSettings) => void;
}

export interface EngineSettingsStore {
  get(): EngineSettings;
  save(raw: unknown): EngineSettings;
}

function load(file: string): EngineSettings {
  try {
    return normalizeEngineSettings(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return DEFAULT_ENGINE_SETTINGS;
  }
}

/**
 * Strict validation for a save: unlike `normalizeEngineSettings` (which repairs
 * a hand-edited file), a request with a bad value is refused so the form shows
 * the error instead of silently storing a default.
 */
function validate(raw: unknown): { engine?: unknown; presetModels?: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EngineSettingsValidationError('body must be an object');
  }
  const body = raw as { engine?: unknown; presetModels?: unknown };
  if (body.engine !== undefined && !isTicketEngine(body.engine)) {
    throw new EngineSettingsValidationError('engine must be "claude" or "gateway"');
  }
  if (body.presetModels !== undefined) {
    if (!body.presetModels || typeof body.presetModels !== 'object' || Array.isArray(body.presetModels)) {
      throw new EngineSettingsValidationError('presetModels must be an object');
    }
    for (const [preset, model] of Object.entries(body.presetModels)) {
      if (!(TICKET_RUN_PRESET_IDS as readonly string[]).includes(preset)) {
        throw new EngineSettingsValidationError(`unknown preset: ${preset}`);
      }
      if (!isValidGatewayModelId(model)) {
        throw new EngineSettingsValidationError(`invalid model id for ${preset}`);
      }
    }
  }
  return body as { engine?: unknown; presetModels?: Record<string, unknown> };
}

export function createEngineSettings(deps: EngineSettingsDeps): EngineSettingsStore {
  let current = load(deps.file);

  return {
    get: () => current,
    save(raw) {
      const body = validate(raw);
      const next = normalizeEngineSettings({
        engine: body.engine ?? current.engine,
        presetModels: { ...current.presetModels, ...(body.presetModels ?? {}) },
      });
      if (next.engine === 'gateway' && !deps.gatewayConfigured()) {
        throw new EngineSettingsValidationError('connect an LLM gateway before selecting it as the engine');
      }
      writePrivateFile(deps.file, JSON.stringify(next, null, 2) + '\n');
      current = next;
      deps.onChange?.(next);
      return next;
    },
  };
}

export interface GatewayAgentEnvInput {
  baseUrl: string;
  /** Empty for a keyless gateway. */
  apiKey: string;
  /** Model the run is pinned to. */
  model: string;
  /** Cheap model for the CLI's background calls (titles, summaries). */
  fastModel: string;
}

/**
 * Env that points the `claude` CLI at the gateway's Anthropic-compatible
 * `/v1/messages`. Every alias the CLI may resolve on its own (subagents asking
 * for `sonnet`, background `haiku` calls) is mapped to a gateway model, because
 * a Claude model id sent to the gateway is a 400.
 */
export function buildGatewayAgentEnv(input: GatewayAgentEnvInput): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: input.baseUrl,
    // A token must be present or the CLI falls back to the Claude login.
    ANTHROPIC_AUTH_TOKEN: input.apiKey || 'no-key',
    // An inherited API key would take precedence over the gateway token.
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: input.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: input.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: input.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: input.fastModel,
    ANTHROPIC_SMALL_FAST_MODEL: input.fastModel,
    CLAUDE_CODE_SUBAGENT_MODEL: input.model,
    // Telemetry/update checks go to Anthropic endpoints the gateway key cannot use.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}
