/**
 * Agent engine settings on the client: which engine new tickets and Claude
 * terminals use (Claude login / LLM gateway) and the preset → gateway model map.
 *
 * One module-level store shared by the settings form and every ticket form. It
 * loads once over HTTP and then follows `engine:update` from the WebSocket, so a
 * save on any dashboard re-labels every open ticket form without a reload.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { EngineSettings, TicketRunPreset } from '@claude-alive/core';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export interface EngineState {
  settings: EngineSettings;
  gatewayConfigured: boolean;
}

let state: EngineState | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setEngineState(next: EngineState | null): void {
  state = next;
  emit();
}

/** A broadcast carries only the settings; gateway state is kept from the last load. */
export function applyEngineUpdate(settings: EngineSettings): void {
  if (!isEngineState({ settings })) return;
  setEngineState({ settings, gatewayConfigured: state?.gatewayConfigured ?? true });
}

/** Only a response shaped like the engine API is trusted; anything else keeps the Claude presets. */
function isEngineState(value: unknown): value is EngineState {
  if (!value || typeof value !== 'object') return false;
  const settings = (value as { settings?: unknown }).settings as Partial<EngineSettings> | undefined;
  return Boolean(
    settings &&
      (settings.engine === 'claude' || settings.engine === 'gateway') &&
      settings.presetModels &&
      typeof settings.presetModels === 'object',
  );
}

export function loadEngineSettings(): Promise<void> {
  loading ??= fetch(`${API_BASE}/api/settings/engine`)
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
    .then((data) => {
      if (isEngineState(data)) setEngineState(data);
    })
    .catch(() => {
      /* older server or offline: forms fall back to the Claude presets */
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current engine state, or null until loaded (and on servers without the feature). */
export function useEngineSettings(): EngineState | null {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!state) void loadEngineSettings();
  }, []);
  return snapshot;
}

export type EngineSaveBody = Partial<Pick<EngineSettings, 'engine'>> & {
  presetModels?: Partial<Record<TicketRunPreset, string>>;
};

export async function saveEngineSettings(body: EngineSaveBody): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${API_BASE}/api/settings/engine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<EngineState> & { error?: string };
  if (!res.ok || !isEngineState(data)) return { ok: false, error: data.error ?? `HTTP ${res.status}`, status: res.status };
  setEngineState({ settings: data.settings, gatewayConfigured: data.gatewayConfigured ?? true });
  return { ok: true };
}

/** Models the configured gateway serves; empty when it is unreachable. */
export async function fetchGatewayModels(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/api/settings/engine/models`);
    if (!res.ok) return [];
    const data = (await res.json()) as { ok?: boolean; models?: string[] };
    return data.ok && Array.isArray(data.models) ? data.models : [];
  } catch {
    return [];
  }
}

/** The gateway model a preset maps to, or null when the Claude engine is active. */
export function gatewayModelFor(engine: EngineState | null, preset: TicketRunPreset): string | null {
  if (!engine || engine.settings.engine !== 'gateway') return null;
  return engine.settings.presetModels[preset];
}
