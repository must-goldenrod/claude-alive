import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { WSBroadcaster } from '../wsServer.js';
import { authorizeUpgrade } from '../wsAuth.js';
import { MIN_TOKEN_CHARS, WS_TOKEN_PROTOCOL_PREFIX, type RemoteAccessConfig } from '../remoteAccess.js';
import type { RemoteTerminalLevel } from '../remoteTerminal.js';

const DEVICE = 'd'.repeat(MIN_TOKEN_CHARS);

interface Harness {
  url: string;
  seen: ReturnType<typeof vi.fn>;
  close: () => void;
}

async function harness(level: RemoteTerminalLevel): Promise<Harness> {
  const seen = vi.fn();
  const config: RemoteAccessConfig = {
    enabled: true, host: '0.0.0.0', trustLoopback: false,
    tokens: [{ label: 'phone', value: DEVICE }], ticketRoots: ['/tmp'], sshHosts: [],
    terminalLevel: level,
  };
  const broadcaster = new WSBroadcaster({
    getSnapshot: () => ({ agents: [], recentEvents: [], completedSessions: [], stats: {}, resumableSessions: [] }),
    onClientMessage: seen,
    remoteTerminalLevel: level,
  });
  const server = createServer();
  server.on('upgrade', (req, socket, head) => {
    const decision = authorizeUpgrade({ headers: req.headers, remoteAddress: req.socket.remoteAddress, port: 0 }, config);
    if (!decision.ok) return void socket.destroy();
    broadcaster.handleUpgrade(req, socket, head, { remote: decision.remote });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  return {
    url: `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`,
    seen,
    close: () => { broadcaster.close(); server.close(); },
  };
}

/** Sends one message as a device and reports whether the server dispatched it. */
async function send(h: Harness, message: object): Promise<boolean> {
  const ws = new WebSocket(h.url, `${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}`);
  await new Promise((resolve) => ws.on('open', resolve));
  h.seen.mockClear();
  ws.send(JSON.stringify(message));
  await new Promise((r) => setTimeout(r, 120));
  ws.close();
  return h.seen.mock.calls.length > 0;
}

const ATTACH = { type: 'terminal:attach', tabId: 'tab1' };
const INPUT = { type: 'terminal:input', tabId: 'tab1', data: 'ls\n' };
const SPAWN = { type: 'terminal:spawn', tabId: 'tab2', mode: 'shell' };

describe('remote terminal levels over a real socket', () => {
  let off: Harness, watch: Harness, input: Harness, shell: Harness;

  beforeAll(async () => {
    [off, watch, input, shell] = await Promise.all([
      harness('off'), harness('watch'), harness('input'), harness('shell'),
    ]);
  });
  afterAll(() => { off.close(); watch.close(); input.close(); shell.close(); });

  it('off: refuses everything terminal, which is the default', async () => {
    expect(await send(off, ATTACH)).toBe(false);
    expect(await send(off, INPUT)).toBe(false);
    expect(await send(off, SPAWN)).toBe(false);
  });

  it('watch: may subscribe to output, may not type or spawn', async () => {
    expect(await send(watch, ATTACH)).toBe(true);
    expect(await send(watch, INPUT)).toBe(false);
    expect(await send(watch, SPAWN)).toBe(false);
  });

  it('input: may type into a pty that is already open, may not start one', async () => {
    expect(await send(input, ATTACH)).toBe(true);
    expect(await send(input, INPUT)).toBe(true);
    expect(await send(input, SPAWN)).toBe(false);
  });

  it('shell: may start one — the token is now equivalent to a shell', async () => {
    expect(await send(shell, ATTACH)).toBe(true);
    expect(await send(shell, INPUT)).toBe(true);
    expect(await send(shell, SPAWN)).toBe(true);
  });
});
