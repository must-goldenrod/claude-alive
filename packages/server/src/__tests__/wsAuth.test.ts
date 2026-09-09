import { describe, it, expect } from 'vitest';
import { authorizeUpgrade, selectWsProtocol, isRemoteWsMessageAllowed } from '../wsAuth.js';
import { MIN_TOKEN_CHARS, WS_TOKEN_PROTOCOL_PREFIX, type RemoteAccessConfig } from '../remoteAccess.js';

const DEVICE = 'd'.repeat(MIN_TOKEN_CHARS);
const LOCAL = 'l'.repeat(MIN_TOKEN_CHARS);

const OFF: RemoteAccessConfig = {
  enabled: false, host: '127.0.0.1', trustLoopback: false, tokens: [], ticketRoots: [], sshHosts: [],
};
const ON: RemoteAccessConfig = {
  enabled: true, host: '0.0.0.0', trustLoopback: false,
  tokens: [{ label: 'phone', value: DEVICE }], ticketRoots: ['/work'], sshHosts: [], localToken: LOCAL,
};

const up = (headers: Record<string, string>, addr = '127.0.0.1') =>
  ({ headers, remoteAddress: addr, port: 3141 });

describe('authorizeUpgrade — remote mode off', () => {
  it('keeps the origin-only behaviour: a native client with no Origin connects', () => {
    expect(authorizeUpgrade(up({}), OFF)).toEqual({ ok: true, remote: false });
  });
  it('still rejects a page served from another host', () => {
    expect(authorizeUpgrade(up({ origin: 'https://evil.example' }), OFF)).toMatchObject({ ok: false });
  });
});

describe('authorizeUpgrade — remote mode on', () => {
  it('rejects an unauthenticated upgrade, loopback included', () => {
    expect(authorizeUpgrade(up({}), ON)).toMatchObject({ ok: false, reason: 'unauthenticated' });
  });

  it('accepts a device token from the subprotocol and marks the connection remote', () => {
    const out = authorizeUpgrade(up({ 'sec-websocket-protocol': `${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}` }, '10.0.0.4'), ON);
    expect(out).toEqual({ ok: true, remote: true, protocol: `${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}` });
  });

  it('accepts a device token from the Authorization header', () => {
    expect(authorizeUpgrade(up({ authorization: `Bearer ${DEVICE}` }, '10.0.0.4'), ON))
      .toMatchObject({ ok: true, remote: true });
  });

  it('treats the local token as a full-access, non-remote connection', () => {
    expect(authorizeUpgrade(up({ authorization: `Bearer ${LOCAL}` }), ON))
      .toMatchObject({ ok: true, remote: false });
  });

  it('rejects a wrong token', () => {
    expect(authorizeUpgrade(up({ authorization: `Bearer ${'x'.repeat(MIN_TOKEN_CHARS)}` }, '10.0.0.4'), ON))
      .toMatchObject({ ok: false, reason: 'unauthenticated' });
  });

  it('lets an authenticated browser connect from the host it was served from', () => {
    const out = authorizeUpgrade(
      { headers: { authorization: `Bearer ${DEVICE}`, origin: 'http://mac.tailnet.ts.net:3141', host: 'mac.tailnet.ts.net:3141' }, remoteAddress: '100.64.0.2', port: 3141 },
      ON,
    );
    expect(out).toMatchObject({ ok: true, remote: true });
  });

  it('rejects an authenticated connection whose Origin is a different site', () => {
    const out = authorizeUpgrade(
      { headers: { authorization: `Bearer ${DEVICE}`, origin: 'https://evil.example', host: 'mac.tailnet.ts.net:3141' }, remoteAddress: '100.64.0.2', port: 3141 },
      ON,
    );
    expect(out).toMatchObject({ ok: false, reason: 'origin' });
  });

  it('trusts loopback when the operator opted in', () => {
    expect(authorizeUpgrade(up({}), { ...ON, trustLoopback: true })).toEqual({ ok: true, remote: false });
  });
});

describe('selectWsProtocol', () => {
  it('echoes the token subprotocol back, which browsers require to stay connected', () => {
    const offered = new Set([`${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}`]);
    expect(selectWsProtocol(offered)).toBe(`${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}`);
  });
  it('selects nothing when the client offered nothing', () => {
    expect(selectWsProtocol(new Set())).toBe(false);
  });
  it('ignores unrelated subprotocols', () => {
    expect(selectWsProtocol(new Set(['graphql-ws']))).toBe(false);
  });
});

describe('isRemoteWsMessageAllowed', () => {
  it('lets a device read the stream', () => {
    expect(isRemoteWsMessageAllowed('ping')).toBe(true);
    expect(isRemoteWsMessageAllowed('request:snapshot')).toBe(true);
  });
  it('refuses every terminal message — a stolen token must not become a shell', () => {
    for (const t of ['terminal:spawn', 'terminal:input', 'terminal:resize', 'terminal:close', 'terminal:attach']) {
      expect(isRemoteWsMessageAllowed(t), t).toBe(false);
    }
  });
});
