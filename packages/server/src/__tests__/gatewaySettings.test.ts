import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, request, type Server, type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createGatewaySettings,
  normalizeGatewayBaseUrl,
  GatewaySettingsValidationError,
  type GatewaySettings,
} from '../gatewaySettings.js';
import { createHttpServer } from '../httpRouter.js';

const SECRET = 'sk-test-secret-abcd1234';

let gateway: Server;
let gatewayUrl: string;
const seenHeaders: IncomingHttpHeaders[] = [];

beforeAll(async () => {
  gateway = createServer((req, res) => {
    seenHeaders.push(req.headers);
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  gatewayUrl = await new Promise<string>((resolve) => {
    gateway.listen(0, '127.0.0.1', () => {
      const addr = gateway.address();
      if (typeof addr === 'object' && addr) resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
});

afterAll(() => {
  gateway.close();
});

let dir: string;
let envFile: string;
let modelsFile: string;
let env: NodeJS.ProcessEnv;
let applied: number;
let settings: GatewaySettings;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ca-gateway-'));
  envFile = join(dir, '.env');
  modelsFile = join(dir, 'models.json');
  env = {};
  applied = 0;
  seenHeaders.length = 0;
  settings = createGatewaySettings({ envFile, modelsFile, env, onApply: () => { applied += 1; } });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('normalizeGatewayBaseUrl', () => {
  it('strips trailing slashes and a trailing /v1', () => {
    expect(normalizeGatewayBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434');
    expect(normalizeGatewayBaseUrl('https://gw.example/')).toBe('https://gw.example');
  });

  it('rejects non-http schemes, multi-line and overlong values', () => {
    expect(() => normalizeGatewayBaseUrl('ftp://x')).toThrow(GatewaySettingsValidationError);
    expect(() => normalizeGatewayBaseUrl('not a url')).toThrow(GatewaySettingsValidationError);
    expect(() => normalizeGatewayBaseUrl('http://a\nB=1')).toThrow(GatewaySettingsValidationError);
    expect(() => normalizeGatewayBaseUrl(`http://a/${'x'.repeat(600)}`)).toThrow(GatewaySettingsValidationError);
  });
});

describe('createGatewaySettings', () => {
  it('reports an empty configuration', () => {
    expect(settings.get()).toEqual({
      baseUrl: null, hasKey: false, keyHint: null, defaultModel: null, hasModelsFile: false, active: false,
    });
  });

  it('saves base URL and key to a 0600 env file, mirrors env, applies, and never returns the key', async () => {
    writeFileSync(envFile, '# keep me\nCLAUDE_ALIVE_PORT=4000\n');
    const result = await settings.save({ baseUrl: `${gatewayUrl}/v1/`, apiKey: SECRET });
    expect(result.applied).toBe(true);
    expect(result.baseUrl).toBe(gatewayUrl);
    expect(result.hasKey).toBe(true);
    expect(result.keyHint).toBe('…1234');
    expect(result.active).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(settings.get())).not.toContain(SECRET);
    expect(applied).toBe(1);
    expect(env.LITELLM_BASE_URL).toBe(gatewayUrl);
    expect(env.LITELLM_KEY).toBe(SECRET);

    const text = readFileSync(envFile, 'utf-8');
    expect(text).toContain('# keep me');
    expect(text).toContain('CLAUDE_ALIVE_PORT=4000');
    expect(text).toContain(`LITELLM_BASE_URL=${gatewayUrl}`);
    expect(text).toContain(`LITELLM_KEY=${SECRET}`);
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it('keeps the stored key when apiKey is omitted and removes it when empty', async () => {
    await settings.save({ baseUrl: gatewayUrl, apiKey: SECRET });
    await settings.save({ baseUrl: gatewayUrl });
    expect(readFileSync(envFile, 'utf-8')).toContain(`LITELLM_KEY=${SECRET}`);
    expect(settings.get().hasKey).toBe(true);

    await settings.save({ baseUrl: gatewayUrl, apiKey: '' });
    expect(readFileSync(envFile, 'utf-8')).not.toContain('LITELLM_KEY');
    expect(env.LITELLM_KEY).toBeUndefined();
    expect(settings.get()).toMatchObject({ hasKey: false, keyHint: null, active: true });
  });

  it('disconnects when baseUrl is empty', async () => {
    await settings.save({ baseUrl: gatewayUrl, apiKey: SECRET });
    const result = await settings.save({ baseUrl: '' });
    const text = readFileSync(envFile, 'utf-8');
    expect(text).not.toContain('LITELLM_BASE_URL');
    expect(text).not.toContain('LITELLM_KEY');
    expect(env.LITELLM_BASE_URL).toBeUndefined();
    expect(env.LITELLM_KEY).toBeUndefined();
    expect(result).toMatchObject({ baseUrl: null, hasKey: false, active: false, applied: true });
    expect(applied).toBe(2);
  });

  it('throws a validation error without writing or applying on bad input', async () => {
    await expect(settings.save({ baseUrl: 'javascript:alert(1)' })).rejects.toBeInstanceOf(GatewaySettingsValidationError);
    await expect(settings.save({ baseUrl: gatewayUrl, apiKey: 'a\nLITELLM_BASE_URL=evil' }))
      .rejects.toBeInstanceOf(GatewaySettingsValidationError);
    expect(existsSync(envFile)).toBe(false);
    expect(applied).toBe(0);
  });

  it('test() lists models and sends no Authorization header for a keyless gateway', async () => {
    const result = await settings.test({ baseUrl: gatewayUrl, apiKey: '' });
    expect(result).toEqual({ ok: true, models: ['m1', 'm2'] });
    expect(seenHeaders[0]?.authorization).toBeUndefined();
  });

  it('test() uses an explicit key, else the stored one', async () => {
    await settings.test({ baseUrl: gatewayUrl, apiKey: 'explicit' });
    expect(seenHeaders.at(-1)?.authorization).toBe('Bearer explicit');
    await settings.save({ baseUrl: gatewayUrl, apiKey: SECRET });
    await settings.test({ baseUrl: gatewayUrl });
    expect(seenHeaders.at(-1)?.authorization).toBe(`Bearer ${SECRET}`);
  });

  it('test() reports an unreachable gateway', async () => {
    const result = await settings.test({ baseUrl: `${gatewayUrl}/nope` });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP 404');
  });

  it('writeModels writes models.json with the requested default when served', async () => {
    const result = await settings.save({ baseUrl: gatewayUrl, defaultModel: 'm2', writeModels: true });
    expect(result.modelsWritten).toBe(true);
    const models = JSON.parse(readFileSync(modelsFile, 'utf-8')) as { defaultModel: string; models: Array<{ id: string }> };
    expect(models.defaultModel).toBe('m2');
    expect(models.models.map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(statSync(modelsFile).mode & 0o777).toBe(0o600);
    expect(result).toMatchObject({ defaultModel: 'm2', hasModelsFile: true });
  });

  it('writeModels falls back to the first model when the default is not served', async () => {
    await settings.save({ baseUrl: gatewayUrl, defaultModel: 'unknown', writeModels: true });
    expect(JSON.parse(readFileSync(modelsFile, 'utf-8')).defaultModel).toBe('m1');
  });
});

describe('gateway settings routes', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = createHttpServer({
      onEvent: () => {},
      getSnapshot: () => ({}),
      renameAgent: () => false,
      removeAgent: () => false,
      getStats: () => ({}),
      getCompletedArchive: () => [],
      getProjectNames: () => ({}),
      saveProjectName: async () => {},
      removeProjectName: async () => {},
      gatewaySettings: settings,
    });
    base = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
  });

  afterEach(() => {
    server.close();
  });

  function call(method: string, path: string, body?: string): Promise<{ status: number; json: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const req = request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : {} }));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  it('GET returns the view', async () => {
    const r = await call('GET', '/api/settings/gateway');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ active: false, hasKey: false });
  });

  it('POST /test returns the probe result, 400 on an invalid body', async () => {
    const ok = await call('POST', '/api/settings/gateway/test', JSON.stringify({ baseUrl: gatewayUrl, apiKey: '' }));
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ ok: true, models: ['m1', 'm2'] });
    const bad = await call('POST', '/api/settings/gateway/test', JSON.stringify({ apiKey: 'x' }));
    expect(bad.status).toBe(400);
    const badUrl = await call('POST', '/api/settings/gateway/test', JSON.stringify({ baseUrl: 'file:///etc' }));
    expect(badUrl.status).toBe(400);
  });

  it('POST saves (key not echoed); 400 on invalid JSON, schema or validation error', async () => {
    const saved = await call('POST', '/api/settings/gateway', JSON.stringify({ baseUrl: gatewayUrl, apiKey: SECRET }));
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ applied: true, hasKey: true, keyHint: '…1234' });
    expect(JSON.stringify(saved.json)).not.toContain(SECRET);

    expect((await call('POST', '/api/settings/gateway', '{not json')).status).toBe(400);
    expect((await call('POST', '/api/settings/gateway', JSON.stringify({ baseUrl: 1 }))).status).toBe(400);
    const invalid = await call('POST', '/api/settings/gateway', JSON.stringify({ baseUrl: 'ftp://x' }));
    expect(invalid.status).toBe(400);
    expect(typeof invalid.json.error).toBe('string');
  });
});
