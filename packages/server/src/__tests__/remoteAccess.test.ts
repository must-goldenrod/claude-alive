import { describe, it, expect } from 'vitest';
import {
  loadRemoteAccessConfig,
  parseTokens,
  verifyToken,
  bearerFromHeaders,
  isRemoteAllowed,
  isLoopbackAddress,
  authorizeRequest,
  createAuthLimiter,
  MIN_TOKEN_CHARS,
} from '../remoteAccess.js';

const LONG = 'a'.repeat(MIN_TOKEN_CHARS);
const OTHER = 'b'.repeat(MIN_TOKEN_CHARS);

function config(over: Partial<Parameters<typeof authorizeRequest>[1]> = {}) {
  return {
    enabled: true,
    host: '0.0.0.0',
    trustLoopback: false,
    tokens: [{ label: 'phone', value: LONG }],
    ticketRoots: ['/work'],
    sshHosts: [],
    ...over,
  } as Parameters<typeof authorizeRequest>[1];
}

describe('isLoopbackAddress', () => {
  it('recognises v4, v6 and v4-mapped loopback', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(a)).toBe(true);
    }
  });
  it('rejects a LAN address and an absent address', () => {
    expect(isLoopbackAddress('192.168.1.9')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe('parseTokens', () => {
  it('reads the single-token variable', () => {
    expect(parseTokens({ CLAUDE_ALIVE_TOKEN: LONG })).toEqual([{ label: 'default', value: LONG }]);
  });
  it('reads labelled entries and trims blanks', () => {
    expect(parseTokens({ CLAUDE_ALIVE_TOKENS: ` phone:${LONG} , ipad:${OTHER} , ` })).toEqual([
      { label: 'phone', value: LONG },
      { label: 'ipad', value: OTHER },
    ]);
  });
  it('accepts a bare value in the list form', () => {
    expect(parseTokens({ CLAUDE_ALIVE_TOKENS: LONG })).toEqual([{ label: 'token1', value: LONG }]);
  });
});

describe('verifyToken', () => {
  const tokens = [{ label: 'phone', value: LONG }, { label: 'ipad', value: OTHER }];
  it('returns the matching label', () => {
    expect(verifyToken(OTHER, tokens)).toBe('ipad');
  });
  it('returns null for a wrong or absent token', () => {
    expect(verifyToken('c'.repeat(MIN_TOKEN_CHARS), tokens)).toBeNull();
    expect(verifyToken(undefined, tokens)).toBeNull();
    expect(verifyToken('', tokens)).toBeNull();
  });
  it('does not throw on a length mismatch', () => {
    expect(verifyToken('short', tokens)).toBeNull();
  });
});

describe('bearerFromHeaders', () => {
  it('extracts a bearer value case-insensitively', () => {
    expect(bearerFromHeaders({ authorization: `Bearer ${LONG}` })).toBe(LONG);
    expect(bearerFromHeaders({ authorization: `bearer ${LONG}` })).toBe(LONG);
  });
  it('reads the websocket subprotocol form', () => {
    expect(bearerFromHeaders({ 'sec-websocket-protocol': `claude-alive.token.${LONG}` })).toBe(LONG);
  });
  it('returns undefined when absent or malformed', () => {
    expect(bearerFromHeaders({})).toBeUndefined();
    expect(bearerFromHeaders({ authorization: LONG })).toBeUndefined();
  });
});

describe('isRemoteAllowed', () => {
  it('allows the ticket surface the app needs', () => {
    expect(isRemoteAllowed('GET', '/api/tickets')).toBe(true);
    expect(isRemoteAllowed('POST', '/api/tickets')).toBe(true);
    expect(isRemoteAllowed('POST', '/api/tickets/t_1/cancel')).toBe(true);
    expect(isRemoteAllowed('POST', '/api/tickets/t_1/reply')).toBe(true);
    expect(isRemoteAllowed('GET', '/api/remote/projects')).toBe(true);
    expect(isRemoteAllowed('GET', '/health')).toBe(true);
  });
  it('denies everything not named, including new routes', () => {
    for (const [m, p] of [
      ['GET', '/api/fs/browse'],
      ['GET', '/api/git/branches'],
      ['POST', '/api/ssh/browse'],
      ['PUT', '/api/projects/names'],
      ['POST', '/api/event'],
      ['DELETE', '/api/agents/x'],
      ['GET', '/api/prompts'],
      ['POST', '/v1/ingest/web'],
      ['GET', '/api/some-future-route'],
      ['GET', '/'],
    ] as const) {
      expect(isRemoteAllowed(m, p), `${m} ${p}`).toBe(false);
    }
  });
  it('does not let a path prefix smuggle a denied route in', () => {
    expect(isRemoteAllowed('GET', '/api/tickets/guide')).toBe(false);
    expect(isRemoteAllowed('POST', '/api/tickets/t_1/evaluate')).toBe(false);
  });
});

describe('authorizeRequest — remote disabled', () => {
  const off = config({ enabled: false, host: '127.0.0.1' });
  it('reports loopback callers as local', () => {
    expect(authorizeRequest({ method: 'GET', pathname: '/api/tickets', headers: {}, remoteAddress: '127.0.0.1' }, off))
      .toEqual({ kind: 'local' });
  });
  it('reports non-loopback callers as remote-denied so per-route gates still answer 403', () => {
    expect(authorizeRequest({ method: 'GET', pathname: '/api/tickets', headers: {}, remoteAddress: '192.168.1.9' }, off))
      .toEqual({ kind: 'untrusted' });
  });
});

describe('authorizeRequest — remote enabled', () => {
  it('rejects a loopback caller with no token: a tunnel makes every remote request look local', () => {
    const out = authorizeRequest(
      { method: 'GET', pathname: '/api/tickets', headers: {}, remoteAddress: '127.0.0.1' },
      config(),
    );
    expect(out).toMatchObject({ kind: 'reject', status: 401 });
  });
  it('trusts loopback only when explicitly opted in', () => {
    const out = authorizeRequest(
      { method: 'GET', pathname: '/api/fs/browse', headers: {}, remoteAddress: '127.0.0.1' },
      config({ trustLoopback: true }),
    );
    expect(out).toEqual({ kind: 'local' });
  });
  it('accepts a valid token on a whitelisted route', () => {
    const out = authorizeRequest(
      { method: 'POST', pathname: '/api/tickets', headers: { authorization: `Bearer ${LONG}` }, remoteAddress: '10.0.0.4' },
      config(),
    );
    expect(out).toEqual({ kind: 'token', label: 'phone', fullAccess: false });
  });
  it('answers 403 for a valid token on a route that is not whitelisted', () => {
    const out = authorizeRequest(
      { method: 'GET', pathname: '/api/fs/browse', headers: { authorization: `Bearer ${LONG}` }, remoteAddress: '10.0.0.4' },
      config(),
    );
    expect(out).toMatchObject({ kind: 'reject', status: 403 });
  });
  it('answers 401 for a bad token', () => {
    const out = authorizeRequest(
      { method: 'GET', pathname: '/api/tickets', headers: { authorization: `Bearer ${OTHER}` }, remoteAddress: '10.0.0.4' },
      config(),
    );
    expect(out).toMatchObject({ kind: 'reject', status: 401 });
  });
  it('never echoes the offered token back in the error', () => {
    const out = authorizeRequest(
      { method: 'GET', pathname: '/api/tickets', headers: { authorization: `Bearer ${OTHER}` }, remoteAddress: '10.0.0.4' },
      config(),
    );
    expect(JSON.stringify(out)).not.toContain(OTHER);
  });
});

describe('createAuthLimiter', () => {
  it('locks a source out after repeated failures and recovers after the window', () => {
    let now = 0;
    const limiter = createAuthLimiter({ maxFailures: 3, windowMs: 1000, now: () => now });
    for (let i = 0; i < 3; i++) limiter.fail('10.0.0.4');
    expect(limiter.locked('10.0.0.4')).toBe(true);
    expect(limiter.locked('10.0.0.5')).toBe(false);
    now = 1001;
    expect(limiter.locked('10.0.0.4')).toBe(false);
  });
  it('clears the counter on success', () => {
    const limiter = createAuthLimiter({ maxFailures: 2, windowMs: 1000, now: () => 0 });
    limiter.fail('x');
    limiter.succeed('x');
    limiter.fail('x');
    expect(limiter.locked('x')).toBe(false);
  });
  it('answers 429 while locked out', () => {
    const limiter = createAuthLimiter({ maxFailures: 1, windowMs: 1000, now: () => 0 });
    const req = { method: 'GET', pathname: '/api/tickets', headers: { authorization: `Bearer ${OTHER}` }, remoteAddress: '10.0.0.9' };
    expect(authorizeRequest(req, config(), limiter)).toMatchObject({ kind: 'reject', status: 401 });
    expect(authorizeRequest(req, config(), limiter)).toMatchObject({ kind: 'reject', status: 429 });
  });
});

describe('loadRemoteAccessConfig', () => {
  it('defaults to loopback with remote off', () => {
    const r = loadRemoteAccessConfig({});
    expect(r).toMatchObject({ ok: true, config: { enabled: false, host: '127.0.0.1' } });
  });
  it('refuses a non-loopback host without remote mode', () => {
    const r = loadRemoteAccessConfig({ CLAUDE_ALIVE_HOST: '0.0.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('CLAUDE_ALIVE_REMOTE');
  });
  it('refuses remote mode without a token', () => {
    const r = loadRemoteAccessConfig({ CLAUDE_ALIVE_REMOTE: '1', CLAUDE_ALIVE_TICKET_ROOTS: '/work' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('CLAUDE_ALIVE_TOKEN');
  });
  it('refuses a short token', () => {
    const r = loadRemoteAccessConfig({ CLAUDE_ALIVE_REMOTE: '1', CLAUDE_ALIVE_TOKEN: 'short', CLAUDE_ALIVE_TICKET_ROOTS: '/work' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/24|characters/);
  });
  it('refuses remote mode without a ticket-root allowlist', () => {
    const r = loadRemoteAccessConfig({ CLAUDE_ALIVE_REMOTE: '1', CLAUDE_ALIVE_TOKEN: LONG });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('CLAUDE_ALIVE_TICKET_ROOTS');
  });
  it('accepts a complete remote configuration and binds all interfaces by default', () => {
    const r = loadRemoteAccessConfig({
      CLAUDE_ALIVE_REMOTE: '1',
      CLAUDE_ALIVE_TOKEN: LONG,
      CLAUDE_ALIVE_TICKET_ROOTS: '/work:/src',
      CLAUDE_ALIVE_REMOTE_SSH_HOSTS: 'build.local',
    });
    expect(r).toMatchObject({
      ok: true,
      config: { enabled: true, host: '0.0.0.0', trustLoopback: false, ticketRoots: ['/work', '/src'], sshHosts: ['build.local'] },
    });
  });
  it('keeps an explicit host in remote mode', () => {
    const r = loadRemoteAccessConfig({
      CLAUDE_ALIVE_REMOTE: '1', CLAUDE_ALIVE_HOST: '100.64.0.1',
      CLAUDE_ALIVE_TOKEN: LONG, CLAUDE_ALIVE_TICKET_ROOTS: '/work',
    });
    expect(r).toMatchObject({ ok: true, config: { host: '100.64.0.1' } });
  });
});

describe('local full-access token', () => {
  const LOCAL = 'l'.repeat(MIN_TOKEN_CHARS);
  const withLocal = () => config({ localToken: LOCAL });

  it('bypasses the route whitelist so hooks and the local dashboard keep working', () => {
    const out = authorizeRequest(
      { method: 'POST', pathname: '/api/event', headers: { authorization: `Bearer ${LOCAL}` }, remoteAddress: '127.0.0.1' },
      withLocal(),
    );
    expect(out).toEqual({ kind: 'token', label: 'local', fullAccess: true });
  });

  it('is still a token, so a caller without it is refused even on loopback', () => {
    expect(
      authorizeRequest({ method: 'POST', pathname: '/api/event', headers: {}, remoteAddress: '127.0.0.1' }, withLocal()),
    ).toMatchObject({ kind: 'reject', status: 401 });
  });

  it('does not grant full access to a device token', () => {
    const out = authorizeRequest(
      { method: 'POST', pathname: '/api/event', headers: { authorization: `Bearer ${LONG}` }, remoteAddress: '10.0.0.4' },
      withLocal(),
    );
    expect(out).toMatchObject({ kind: 'reject', status: 403 });
  });
});

describe('?token= bootstrap for the served dashboard', () => {
  const LOCAL = 'l'.repeat(MIN_TOKEN_CHARS);
  it('accepts a query token for the UI shell, which has no way to set a header', () => {
    const out = authorizeRequest(
      { method: 'GET', pathname: '/', headers: {}, remoteAddress: '127.0.0.1', searchToken: LOCAL },
      config({ localToken: LOCAL }),
    );
    expect(out).toMatchObject({ kind: 'token', fullAccess: true });
  });
  it('refuses a query token on an API route — URLs end up in logs and referrers', () => {
    const out = authorizeRequest(
      { method: 'GET', pathname: '/api/tickets', headers: {}, remoteAddress: '10.0.0.4', searchToken: LONG },
      config(),
    );
    expect(out).toMatchObject({ kind: 'reject', status: 401 });
  });
});
