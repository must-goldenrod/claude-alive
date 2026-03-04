import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { TerminalWSServer } from '../wsServer.js';
import { PtyManager } from '../ptyManager.js';

let httpServer: Server;
let terminalWs: TerminalWSServer;
let ptyManager: PtyManager;
let wsUrl: string;

beforeAll(async () => {
  ptyManager = new PtyManager({ maxSessions: 5 });
  httpServer = createServer();
  terminalWs = new TerminalWSServer(httpServer, ptyManager);
  wsUrl = await new Promise<string>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      if (typeof addr === 'object' && addr) {
        resolve(`ws://localhost:${addr.port}/ws/terminal`);
      }
    });
  });
});

afterEach(() => {
  ptyManager.destroyAll();
});

afterAll(() => {
  terminalWs.close();
  httpServer.close();
});

function connectTerminal(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, filter: (msg: Record<string, unknown>) => boolean, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitForMessage timed out')), timeoutMs);
    const handler = (raw: WebSocket.Data) => {
      const msg = JSON.parse(raw.toString());
      if (filter(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('Terminal WebSocket', () => {
  it('can create TerminalWSServer', () => {
    expect(terminalWs).toBeDefined();
  });

  it('accepts WebSocket connections', async () => {
    const ws = await connectTerminal();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => ws.on('close', r));
  });

  it('terminal:create returns terminal:created with sessionId', async () => {
    const ws = await connectTerminal();
    const msgPromise = waitForMessage(ws, (m) => m.type === 'terminal:created');
    ws.send(JSON.stringify({ type: 'terminal:create', cwd: '/tmp' }));
    const msg = await msgPromise;
    expect(msg.type).toBe('terminal:created');
    expect(typeof msg.sessionId).toBe('string');
    expect((msg.sessionId as string).length).toBeGreaterThan(0);
    ws.close();
    await new Promise((r) => ws.on('close', r));
  });

  it('receives terminal:output after creating a session', async () => {
    const ws = await connectTerminal();
    const createdPromise = waitForMessage(ws, (m) => m.type === 'terminal:created');
    ws.send(JSON.stringify({ type: 'terminal:create', cwd: '/tmp' }));
    const created = await createdPromise;

    // Shell outputs prompt/banner text on startup
    const output = await waitForMessage(ws, (m) => m.type === 'terminal:output');
    expect(output.type).toBe('terminal:output');
    expect(output.sessionId).toBe(created.sessionId);
    expect(typeof output.data).toBe('string');

    ws.close();
    await new Promise((r) => ws.on('close', r));
  });

  it('returns terminal:error when max sessions reached', async () => {
    const mgr = new PtyManager({ maxSessions: 1 });
    const server2 = createServer();
    const termWs2 = new TerminalWSServer(server2, mgr);
    const url2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        if (typeof addr === 'object' && addr) {
          resolve(`ws://localhost:${addr.port}/ws/terminal`);
        }
      });
    });

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const w = new WebSocket(url2);
      w.on('open', () => resolve(w));
      w.on('error', reject);
    });

    // First create should succeed
    const created1 = waitForMessage(ws, (m) => m.type === 'terminal:created');
    ws.send(JSON.stringify({ type: 'terminal:create', cwd: '/tmp' }));
    await created1;

    // Second create should fail
    const errorMsg = waitForMessage(ws, (m) => m.type === 'terminal:error');
    ws.send(JSON.stringify({ type: 'terminal:create', cwd: '/tmp' }));
    const err = await errorMsg;
    expect(err.type).toBe('terminal:error');

    ws.close();
    await new Promise((r) => ws.on('close', r));
    mgr.destroyAll();
    termWs2.close();
    server2.close();
  });

  it('ignores malformed messages', async () => {
    const ws = await connectTerminal();
    // Send garbage - should not crash
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'unknown' }));

    // Should still be able to create a session after malformed messages
    const msgPromise = waitForMessage(ws, (m) => m.type === 'terminal:created');
    ws.send(JSON.stringify({ type: 'terminal:create', cwd: '/tmp' }));
    const msg = await msgPromise;
    expect(msg.type).toBe('terminal:created');

    ws.close();
    await new Promise((r) => ws.on('close', r));
  });
});
