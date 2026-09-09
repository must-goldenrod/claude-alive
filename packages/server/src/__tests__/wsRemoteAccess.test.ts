import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { WSBroadcaster } from '../wsServer.js';
import { authorizeUpgrade } from '../wsAuth.js';
import { MIN_TOKEN_CHARS, WS_TOKEN_PROTOCOL_PREFIX, type RemoteAccessConfig } from '../remoteAccess.js';

const DEVICE = 'd'.repeat(MIN_TOKEN_CHARS);
const LOCAL = 'l'.repeat(MIN_TOKEN_CHARS);

const config: RemoteAccessConfig = {
  enabled: true, host: '0.0.0.0', trustLoopback: false,
  tokens: [{ label: 'phone', value: DEVICE }], ticketRoots: ['/tmp'], sshHosts: [], localToken: LOCAL,
};

const onClientMessage = vi.fn();
let httpServer: Server;
let broadcaster: WSBroadcaster;
let wsUrl: string;

beforeAll(async () => {
  broadcaster = new WSBroadcaster({
    getSnapshot: () => ({ agents: [], recentEvents: [], completedSessions: [], stats: {}, resumableSessions: [] }),
    onClientMessage,
  });
  httpServer = createServer();
  httpServer.on('upgrade', (req, socket, head) => {
    const decision = authorizeUpgrade(
      { headers: req.headers, remoteAddress: req.socket.remoteAddress, port: 0 },
      config,
    );
    if (!decision.ok) {
      socket.destroy();
      return;
    }
    broadcaster.handleUpgrade(req, socket, head, { remote: decision.remote });
  });
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
  const addr = httpServer.address();
  wsUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`;
});

afterAll(() => {
  broadcaster.close();
  httpServer.close();
});

/**
 * Connects and buffers from the first frame: the server sends the snapshot the
 * moment the connection opens, so a listener attached after `open` misses it.
 */
function connect(
  protocols?: string | string[],
  headers?: Record<string, string>,
): Promise<{ ws: WebSocket | null; opened: boolean; messages: string[] }> {
  return new Promise((resolve) => {
    const messages: string[] = [];
    const ws = new WebSocket(wsUrl, protocols as never, headers ? { headers } : undefined);
    ws.on('message', (d) => messages.push(d.toString()));
    ws.on('open', () => resolve({ ws, opened: true, messages }));
    ws.on('error', () => resolve({ ws: null, opened: false, messages }));
  });
}

describe('WebSocket upgrade under remote mode', () => {
  it('refuses a connection with no token, even from 127.0.0.1', async () => {
    const { opened } = await connect();
    expect(opened).toBe(false);
  });

  it('accepts a device token offered as a subprotocol and echoes it back', async () => {
    const { ws, opened } = await connect(`${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}`);
    expect(opened).toBe(true);
    expect(ws?.protocol).toBe(`${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}`);
    ws?.close();
  });

  it('streams the snapshot to an authenticated device', async () => {
    const { ws, messages } = await connect(`${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.map((m) => JSON.parse(m).type)).toContain('snapshot');
    ws!.close();
  });

  it('drops terminal:spawn from a device connection', async () => {
    onClientMessage.mockClear();
    const { ws } = await connect(`${WS_TOKEN_PROTOCOL_PREFIX}${DEVICE}`);
    ws!.send(JSON.stringify({ type: 'terminal:spawn', tabId: 'tab1', mode: 'shell' }));
    await new Promise((r) => setTimeout(r, 120));
    expect(onClientMessage).not.toHaveBeenCalled();
    ws!.close();
  });

  it('lets the local token drive a terminal', async () => {
    onClientMessage.mockClear();
    const { ws, opened } = await connect(undefined, { Authorization: `Bearer ${LOCAL}` });
    expect(opened).toBe(true);
    ws!.send(JSON.stringify({ type: 'terminal:spawn', tabId: 'tab2', mode: 'shell' }));
    await new Promise((r) => setTimeout(r, 120));
    expect(onClientMessage).toHaveBeenCalledTimes(1);
    ws!.close();
  });
});
