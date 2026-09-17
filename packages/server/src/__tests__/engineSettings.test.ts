import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request, type Server } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EngineSettings } from '@claude-alive/core';
import {
  buildGatewayAgentEnv,
  createEngineSettings,
  EngineSettingsValidationError,
  type EngineSettingsStore,
} from '../engineSettings.js';
import { createHttpServer } from '../httpRouter.js';
import { MIN_TOKEN_CHARS, type RemoteAccessConfig } from '../remoteAccess.js';

let dir: string;
let file: string;
let gatewayOn: boolean;
let changes: EngineSettings[];
let store: EngineSettingsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ca-engine-'));
  file = join(dir, 'engine.json');
  gatewayOn = true;
  changes = [];
  store = createEngineSettings({ file, gatewayConfigured: () => gatewayOn, onChange: (s) => changes.push(s) });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createEngineSettings', () => {
  it('starts on the Claude engine with the glm-5.3 mapping and no file', () => {
    expect(store.get().engine).toBe('claude');
    expect(store.get().presetModels).toMatchObject({ fast: 'glm-5.3-flash', standard: 'glm-5.3' });
    expect(existsSync(file)).toBe(false);
  });

  it('saves a partial update, persists it privately, applies it in memory and notifies', () => {
    const saved = store.save({ engine: 'gateway', presetModels: { deep: 'kimi-k3' } });
    expect(saved.engine).toBe('gateway');
    expect(saved.presetModels.deep).toBe('kimi-k3');
    expect(saved.presetModels.standard).toBe('glm-5.3');
    expect(store.get()).toEqual(saved);
    expect(changes).toEqual([saved]);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(saved);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    // A fresh store (server restart) reads the same settings back.
    const reloaded = createEngineSettings({ file, gatewayConfigured: () => true });
    expect(reloaded.get()).toEqual(saved);
  });

  it('refuses the gateway engine while no gateway is configured', () => {
    gatewayOn = false;
    expect(() => store.save({ engine: 'gateway' })).toThrow(EngineSettingsValidationError);
    expect(store.get().engine).toBe('claude');
    expect(changes).toHaveLength(0);
    // Mapping edits and switching back to Claude stay allowed.
    expect(store.save({ engine: 'claude', presetModels: { fast: 'gemma4' } }).presetModels.fast).toBe('gemma4');
  });

  it('rejects bad engines, presets and model ids without writing', () => {
    expect(() => store.save({ engine: 'openai' })).toThrow(EngineSettingsValidationError);
    expect(() => store.save({ presetModels: { turbo: 'glm-5.3' } })).toThrow(/unknown preset/);
    expect(() => store.save({ presetModels: { fast: 'x; rm -rf ~' } })).toThrow(/invalid model id/);
    expect(() => store.save([])).toThrow(EngineSettingsValidationError);
    expect(existsSync(file)).toBe(false);
  });

  it('repairs a hand-edited file instead of failing to boot', () => {
    writeFileSync(file, JSON.stringify({ engine: 'gateway', presetModels: { fast: '$(boom)' } }));
    const repaired = createEngineSettings({ file, gatewayConfigured: () => true }).get();
    expect(repaired.engine).toBe('gateway');
    expect(repaired.presetModels.fast).toBe('glm-5.3-flash');
    writeFileSync(file, '{broken');
    expect(createEngineSettings({ file, gatewayConfigured: () => true }).get().engine).toBe('claude');
  });
});

describe('buildGatewayAgentEnv', () => {
  it('points the CLI at the gateway and maps every model alias', () => {
    const env = buildGatewayAgentEnv({ baseUrl: 'https://gw', apiKey: 'k', model: 'glm-5.3', fastModel: 'glm-5.3-flash' });
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://gw',
      ANTHROPIC_AUTH_TOKEN: 'k',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'glm-5.3',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.3-flash',
      ANTHROPIC_SMALL_FAST_MODEL: 'glm-5.3-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'glm-5.3',
    });
  });

  it('still sends a token for a keyless gateway so the CLI never falls back to the Claude login', () => {
    const env = buildGatewayAgentEnv({ baseUrl: 'http://localhost:11434', apiKey: '', model: 'm', fastModel: 'm' });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('no-key');
  });
});

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function call(
  base: string, method: string, path: string, body?: string, token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = request(`${base}${path}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function routerOptions(extra: Record<string, unknown> = {}) {
  return {
    onEvent: () => {},
    getSnapshot: () => ({}),
    renameAgent: () => false,
    removeAgent: () => false,
    getStats: () => ({}),
    getCompletedArchive: () => [],
    getProjectNames: () => ({}),
    saveProjectName: async () => {},
    removeProjectName: async () => {},
    engineSettings: {
      get: () => ({ settings: store.get(), gatewayConfigured: gatewayOn }),
      save: (raw: unknown) => ({ settings: store.save(raw), gatewayConfigured: gatewayOn }),
      models: async () => ({ ok: true, models: ['glm-5.3', 'glm-5.3-flash'] }),
    },
    ...extra,
  };
}

describe('engine settings routes', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = createHttpServer(routerOptions());
    base = await listen(server);
  });
  afterEach(() => {
    server.close();
  });

  it('GET returns settings and gateway state; models lists the gateway models', async () => {
    const r = await call(base, 'GET', '/api/settings/engine');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ settings: { engine: 'claude' }, gatewayConfigured: true });
    const m = await call(base, 'GET', '/api/settings/engine/models');
    expect(m.json).toEqual({ ok: true, models: ['glm-5.3', 'glm-5.3-flash'] });
  });

  it('POST saves; 400 on invalid JSON or validation error', async () => {
    const saved = await call(base, 'POST', '/api/settings/engine', JSON.stringify({ engine: 'gateway' }));
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ settings: { engine: 'gateway' } });
    expect((await call(base, 'POST', '/api/settings/engine', '{nope')).status).toBe(400);
    const bad = await call(base, 'POST', '/api/settings/engine', JSON.stringify({ presetModels: { fast: 'a b' } }));
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/invalid model id/);
  });
});

describe('engine settings routes in remote mode', () => {
  const DEVICE = 'd'.repeat(MIN_TOKEN_CHARS);
  const LOCAL = 'l'.repeat(MIN_TOKEN_CHARS);
  const remoteAccess: RemoteAccessConfig = {
    enabled: true,
    host: '0.0.0.0',
    trustLoopback: false,
    tokens: [{ label: 'phone', value: DEVICE }],
    ticketRoots: ['/tmp'],
    sshHosts: [],
    localToken: LOCAL,
    terminalLevel: 'off',
  };
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = createHttpServer(routerOptions({ remoteAccess }));
    base = await listen(server);
  });
  afterEach(() => {
    server.close();
  });

  it('lets a device read the engine (its ticket form needs it) but not change it', async () => {
    expect((await call(base, 'GET', '/api/settings/engine', undefined, DEVICE)).status).toBe(200);
    const body = JSON.stringify({ engine: 'gateway' });
    expect((await call(base, 'POST', '/api/settings/engine', body, DEVICE)).status).toBe(403);
    expect(store.get().engine).toBe('claude');
    expect((await call(base, 'POST', '/api/settings/engine', body, LOCAL)).status).toBe(200);
    expect(store.get().engine).toBe('gateway');
  });
});
