/**
 * Dashboard-editable LLM gateway settings (Settings → Backend).
 *
 * Reads and writes the two files the server loads at startup —
 * `~/.claude-alive/.env` (LITELLM_BASE_URL, LITELLM_KEY; mode 0600) and
 * `~/.claude-alive/models.json` — mirrors the change into the process env, then
 * calls `onApply` so the server rebuilds its gateway client without a restart.
 *
 * The API key never leaves this module: `get()` reports only whether one is
 * stored and its last four characters.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  upsertEnvValue,
  readEnvKey,
  parseModelIds,
  buildModelsFile,
  writePrivateFile,
} from '@claude-alive/core';

export const GATEWAY_TEST_TIMEOUT_MS = 10_000;
export const MAX_GATEWAY_FIELD_LENGTH = 500;

const BASE_URL_KEY = 'LITELLM_BASE_URL';
const API_KEY_KEY = 'LITELLM_KEY';

export interface GatewaySettingsView {
  baseUrl: string | null;
  hasKey: boolean;
  /** "…" + last 4 characters of the stored key; null when there is no key. */
  keyHint: string | null;
  /** `defaultModel` from models.json, when that file exists and names one. */
  defaultModel: string | null;
  hasModelsFile: boolean;
  /** A gateway client is configured (base URL or key present). */
  active: boolean;
}

export interface GatewayTestInput {
  baseUrl: string;
  /** undefined → use the stored key; '' → test without a key. */
  apiKey?: string;
}

export interface GatewayTestResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

export interface GatewaySaveInput {
  /** '' disconnects: removes both LITELLM_BASE_URL and LITELLM_KEY. */
  baseUrl: string;
  /** undefined keeps the stored key, '' removes it. */
  apiKey?: string;
  defaultModel?: string;
  /** Probe the gateway and (on success) write models.json from its model list. */
  writeModels?: boolean;
}

export interface GatewaySaveResult extends GatewaySettingsView {
  applied: true;
  /** Present when `writeModels` was requested: the probe outcome. */
  modelsWritten?: boolean;
  modelsError?: string;
}

export interface GatewaySettingsDeps {
  envFile: string;
  modelsFile: string;
  /** Process env to read and mirror writes into (production: process.env). */
  env: NodeJS.ProcessEnv;
  /** Rebuild whatever depends on the gateway configuration. */
  onApply: () => void;
  fetchImpl?: typeof fetch;
}

export interface GatewaySettings {
  get(): GatewaySettingsView;
  test(input: GatewayTestInput): Promise<GatewayTestResult>;
  save(input: GatewaySaveInput): Promise<GatewaySaveResult>;
}

/** Bad user input; the HTTP layer maps it to 400. */
export class GatewaySettingsValidationError extends Error {
  readonly name = 'GatewaySettingsValidationError';
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function checkSingleLine(value: string, field: string): void {
  if (/[\r\n]/.test(value)) throw new GatewaySettingsValidationError(`${field} must be a single line`);
  if (value.length > MAX_GATEWAY_FIELD_LENGTH) {
    throw new GatewaySettingsValidationError(`${field} must be at most ${MAX_GATEWAY_FIELD_LENGTH} characters`);
  }
}

/**
 * Validate and canonicalise a gateway base URL: http(s) only, no trailing
 * slash, no trailing `/v1` (the client appends `/v1/...` itself).
 */
export function normalizeGatewayBaseUrl(raw: string): string {
  const value = raw.trim();
  checkSingleLine(value, 'baseUrl');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GatewaySettingsValidationError('baseUrl must be a valid http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new GatewaySettingsValidationError('baseUrl must use http or https');
  }
  let out = value.replace(/\/+$/, '');
  if (/\/v1$/i.test(out)) out = out.slice(0, -3).replace(/\/+$/, '');
  return out;
}

function normalizeApiKey(raw: string): string {
  const value = raw.trim();
  checkSingleLine(value, 'apiKey');
  return value;
}

function readModelsDefault(path: string): { exists: boolean; defaultModel: string | null } {
  if (!existsSync(path)) return { exists: false, defaultModel: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { defaultModel?: unknown };
    const dm = typeof parsed.defaultModel === 'string' && parsed.defaultModel.trim() ? parsed.defaultModel.trim() : null;
    return { exists: true, defaultModel: dm };
  } catch {
    return { exists: true, defaultModel: null };
  }
}

export function createGatewaySettings(deps: GatewaySettingsDeps): GatewaySettings {
  const doFetch = deps.fetchImpl ?? fetch;
  const { env } = deps;

  /** Process env wins over the file, matching loadServerEnv. */
  function current(key: string): string | undefined {
    const fromEnv = env[key]?.trim();
    if (fromEnv) return fromEnv;
    const fromFile = readEnvKey(readText(deps.envFile), key)?.trim();
    return fromFile || undefined;
  }

  function get(): GatewaySettingsView {
    const baseUrl = current(BASE_URL_KEY) ?? null;
    const key = current(API_KEY_KEY);
    const models = readModelsDefault(deps.modelsFile);
    return {
      baseUrl,
      hasKey: Boolean(key),
      keyHint: key ? `…${key.slice(-4)}` : null,
      defaultModel: models.defaultModel,
      hasModelsFile: models.exists,
      active: Boolean(baseUrl || key),
    };
  }

  async function probe(baseUrl: string, apiKey: string): Promise<GatewayTestResult> {
    try {
      const res = await doFetch(`${baseUrl}/v1/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(GATEWAY_TEST_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, models: parseModelIds(await res.json()) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function test(input: GatewayTestInput): Promise<GatewayTestResult> {
    const baseUrl = normalizeGatewayBaseUrl(input.baseUrl);
    const apiKey = input.apiKey === undefined ? (current(API_KEY_KEY) ?? '') : normalizeApiKey(input.apiKey);
    return probe(baseUrl, apiKey);
  }

  function mirror(key: string, value: string | undefined): void {
    if (value) env[key] = value;
    else delete env[key];
  }

  async function save(input: GatewaySaveInput): Promise<GatewaySaveResult> {
    const disconnect = input.baseUrl.trim() === '';
    const baseUrl = disconnect ? undefined : normalizeGatewayBaseUrl(input.baseUrl);
    const apiKeyInput = input.apiKey === undefined ? undefined : normalizeApiKey(input.apiKey);
    if (input.defaultModel !== undefined) checkSingleLine(input.defaultModel, 'defaultModel');

    // undefined keeps the stored key; '' removes it; disconnect removes both.
    const storedKey = current(API_KEY_KEY);
    const nextKey = disconnect ? undefined : apiKeyInput === undefined ? storedKey : apiKeyInput || undefined;

    let text = readText(deps.envFile);
    text = upsertEnvValue(text, BASE_URL_KEY, baseUrl);
    if (disconnect || apiKeyInput !== undefined) text = upsertEnvValue(text, API_KEY_KEY, nextKey);

    let modelsWritten: boolean | undefined;
    let modelsError: string | undefined;
    if (input.writeModels && baseUrl) {
      const result = await probe(baseUrl, nextKey ?? '');
      if (result.ok && result.models && result.models.length > 0) {
        const ids = result.models;
        const wanted = input.defaultModel?.trim();
        const defaultModel = wanted && ids.includes(wanted) ? wanted : ids[0]!;
        writePrivateFile(deps.modelsFile, JSON.stringify(buildModelsFile(ids, defaultModel), null, 2) + '\n');
        modelsWritten = true;
      } else {
        modelsWritten = false;
        modelsError = result.ok ? 'gateway listed no models' : result.error;
      }
    }

    writePrivateFile(deps.envFile, text);
    mirror(BASE_URL_KEY, baseUrl);
    if (disconnect || apiKeyInput !== undefined) mirror(API_KEY_KEY, nextKey);
    deps.onApply();

    return {
      ...get(),
      applied: true,
      ...(modelsWritten !== undefined ? { modelsWritten } : {}),
      ...(modelsError !== undefined ? { modelsError } : {}),
    };
  }

  return { get, test, save };
}
