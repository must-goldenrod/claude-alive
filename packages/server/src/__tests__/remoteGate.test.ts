import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { createHttpServer } from '../httpRouter.js';
import { MIN_TOKEN_CHARS, type RemoteAccessConfig } from '../remoteAccess.js';

const DEVICE = 'd'.repeat(MIN_TOKEN_CHARS);
const LOCAL = 'l'.repeat(MIN_TOKEN_CHARS);

const remoteConfig: RemoteAccessConfig = {
  enabled: true,
  host: '0.0.0.0',
  trustLoopback: false,
  tokens: [{ label: 'phone', value: DEVICE }],
  ticketRoots: ['/tmp'],
  sshHosts: [],
  localToken: LOCAL,
};

const promptRouter = vi.fn((_req: unknown, res: { writeHead: (n: number) => void; end: (s: string) => void }) => {
  res.writeHead(200);
  res.end('{"prompts":[]}');
});

const onEvent = vi.fn();
const ticketCreate = vi.fn(async () => ({ id: 't_1' }));

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

/** Every request in this file arrives on loopback — which is the point: with
 *  remote mode on, a loopback address is no longer evidence of anything. */
const auth = (token?: string) => (token ? { Authorization: `Bearer ${token}` } : undefined);

let server: Server;
let base: string;
let openServer: Server;
let openBase: string;

beforeAll(async () => {
  server = createHttpServer({
    onEvent,
    getSnapshot: () => ({ agents: [] }),
    renameAgent: () => true,
    removeAgent: () => true,
    getStats: () => ({}),
    getCompletedArchive: () => [],
    getProjectNames: () => ({}),
    saveProjectName: async () => {},
    removeProjectName: async () => {},
    remoteAccess: remoteConfig,
    promptRouter: promptRouter as never,
    tickets: {
      list: () => [],
      create: ticketCreate,
      retry: async () => undefined,
      cancel: async () => undefined,
      remove: async () => true,
      validateRemoteCreate: (input) => (input.cwd.startsWith('/tmp') ? null : 'cwd not in allowlist'),
    },
    remoteProjects: async () => [{ path: '/tmp/demo', name: 'demo' }],
  });
  base = await listen(server);

  openServer = createHttpServer({
    onEvent: () => {},
    getSnapshot: () => ({ agents: [] }),
    renameAgent: () => true,
    removeAgent: () => true,
    getStats: () => ({}),
    getCompletedArchive: () => [],
    getProjectNames: () => ({}),
    saveProjectName: async () => {},
    removeProjectName: async () => {},
    tickets: { list: () => [], create: ticketCreate, retry: async () => undefined, cancel: async () => undefined, remove: async () => true },
  });
  openBase = await listen(openServer);
});

afterAll(() => {
  server.close();
  openServer.close();
});

describe('remote mode off — behaviour is unchanged', () => {
  it('serves a loopback caller with no token', async () => {
    expect((await fetch(`${openBase}/api/tickets`)).status).toBe(200);
  });
});

describe('remote mode on — no token', () => {
  it('answers 401 even though the request came from 127.0.0.1', async () => {
    expect((await fetch(`${base}/api/tickets`)).status).toBe(401);
    expect((await fetch(`${base}/api/status`)).status).toBe(401);
    expect((await fetch(`${base}/health`)).status).toBe(401);
  });

  it('refuses prompt-subsystem paths before delegating to them', async () => {
    promptRouter.mockClear();
    expect((await fetch(`${base}/api/prompts`)).status).toBe(401);
    expect((await fetch(`${base}/api/sessions`)).status).toBe(401);
    expect((await fetch(`${base}/v1/ingest/web`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect(promptRouter).not.toHaveBeenCalled();
  });

  it('does not reveal whether a route exists', async () => {
    expect((await fetch(`${base}/api/no-such-route`)).status).toBe(401);
  });

  it('never puts a token in the response body', async () => {
    const body = await (await fetch(`${base}/api/tickets`, { headers: auth(DEVICE.slice(0, -1) + 'x') })).text();
    expect(body).not.toContain(DEVICE);
  });
});

describe('remote mode on — device token', () => {
  it('reaches the allowlisted ticket surface', async () => {
    expect((await fetch(`${base}/api/tickets`, { headers: auth(DEVICE) })).status).toBe(200);
    expect((await fetch(`${base}/api/status`, { headers: auth(DEVICE) })).status).toBe(200);
  });

  it('creates a ticket inside an allowed root', async () => {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(DEVICE) },
      body: JSON.stringify({ goal: 'do a thing', cwd: '/tmp/demo' }),
    });
    expect(res.status).toBe(201);
  });

  it('refuses a ticket outside the allowed roots', async () => {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(DEVICE) },
      body: JSON.stringify({ goal: 'escape', cwd: '/etc' }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('allowlist');
  });

  it('is refused on every route outside the allowlist', async () => {
    for (const [path, init] of [
      ['/api/fs/browse?dir=/', undefined],
      ['/api/prompts', undefined],
      ['/api/event', { method: 'POST', body: '{}' }],
      ['/api/projects/names', { method: 'PUT', body: '{}' }],
      ['/api/agents/x', { method: 'DELETE' }],
      ['/api/git/branches?cwd=/tmp', undefined],
    ] as const) {
      const res = await fetch(`${base}${path}`, { ...(init ?? {}), headers: auth(DEVICE) });
      expect(res.status, path).toBe(403);
    }
  });

  it('lists projects only from the configured roots', async () => {
    const res = await fetch(`${base}/api/remote/projects`, { headers: auth(DEVICE) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: [{ path: '/tmp/demo', name: 'demo' }] });
  });
});

describe('remote mode on — local full-access token', () => {
  it('accepts the hook ingest route', async () => {
    onEvent.mockClear();
    const res = await fetch(`${base}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(LOCAL) },
      body: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', cwd: '/tmp' }),
    });
    expect(res.status).toBe(200);
    expect(onEvent).toHaveBeenCalled();
  });

  it('reaches routes a device token cannot', async () => {
    expect((await fetch(`${base}/api/fs/browse?dir=/tmp`, { headers: auth(LOCAL) })).status).toBe(200);
  });

  it('bootstraps the dashboard through ?token=', async () => {
    expect((await fetch(`${base}/?token=${LOCAL}`)).status).not.toBe(401);
  });

  it('refuses ?token= on an API route', async () => {
    expect((await fetch(`${base}/api/tickets?token=${LOCAL}`)).status).toBe(401);
  });
});
