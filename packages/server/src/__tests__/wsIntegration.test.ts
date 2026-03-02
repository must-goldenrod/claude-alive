import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import WebSocket from 'ws';
import { SessionStore } from '@claude-alive/core';
import type { HookEventPayload, WSServerMessage } from '@claude-alive/core';
import { createHttpServer } from '../httpRouter.js';
import { WSBroadcaster } from '../wsServer.js';

let httpServer: Server;
let broadcaster: WSBroadcaster;
let baseUrl: string;
let wsUrl: string;
const store = new SessionStore();

function getSnapshot() {
  return {
    agents: store.getAllAgents(),
    recentEvents: store.getRecentEvents(100),
    completedSessions: store.getCompletedSessions(),
  };
}

function onEvent(payload: HookEventPayload): void {
  const agent = store.processEvent(payload);
  if (!agent) return;
  const event = payload.event;
  if (event === 'SessionStart' || event === 'SubagentStart') {
    broadcaster.broadcast({ type: 'agent:spawn', agent });
  } else if (event === 'SessionEnd' || event === 'SubagentStop') {
    broadcaster.broadcast({ type: 'agent:despawn', sessionId: agent.sessionId });
  } else {
    broadcaster.broadcast({
      type: 'agent:state',
      sessionId: agent.sessionId,
      state: agent.state,
      tool: agent.currentTool,
      animation: agent.currentToolAnimation,
      timestamp: payload.timestamp,
    });
  }
}

/** A buffered WS client that captures all messages from connection start. */
class TestClient {
  ws: WebSocket;
  messages: WSServerMessage[] = [];
  private waiters: Array<{ filter: (m: WSServerMessage) => boolean; resolve: (m: WSServerMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as WSServerMessage;
      this.messages.push(msg);
      // Check pending waiters
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i]!;
        if (w.filter(msg)) {
          clearTimeout(w.timer);
          this.waiters.splice(i, 1);
          w.resolve(msg);
        }
      }
    });
  }

  /** Wait for a message matching the filter. Checks buffered messages first. */
  waitFor(filter: (m: WSServerMessage) => boolean, timeoutMs = 3000): Promise<WSServerMessage> {
    // Check existing buffer
    const found = this.messages.find(filter);
    if (found) return Promise.resolve(found);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({ filter, resolve, reject, timer });
    });
  }

  /** Wait for snapshot then clear buffer so subsequent waitFor calls don't match stale messages. */
  async drainSnapshot(): Promise<WSServerMessage> {
    const snap = await this.waitFor((m) => m.type === 'snapshot');
    this.messages = [];
    return snap;
  }

  send(data: unknown) {
    this.ws.send(JSON.stringify(data));
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      this.ws.on('close', () => resolve());
      this.ws.close();
    });
  }
}

function connectClient(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const client = new TestClient(ws);
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

function postEvent(event: string, sessionId: string, extra: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      tool: extra.tool_name ?? 'system',
      session_id: sessionId,
      timestamp: Date.now(),
      data: { session_id: sessionId, hook_event_name: event, cwd: '/tmp/test', ...extra },
    }),
  });
}

beforeAll(async () => {
  httpServer = createHttpServer({
    onEvent,
    getSnapshot,
    renameAgent: (id, name) => {
      const ok = store.renameAgent(id, name);
      if (ok) broadcaster.broadcast({ type: 'agent:rename', sessionId: id, name });
      return ok;
    },
    removeAgent: (id) => store.removeAgent(id),
  });
  broadcaster = new WSBroadcaster(httpServer, { getSnapshot, maxClients: 50 });
  baseUrl = await new Promise<string>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      if (typeof addr === 'object' && addr) resolve(`http://localhost:${addr.port}`);
    });
  });
  wsUrl = baseUrl.replace('http', 'ws') + '/ws';
});

afterAll(() => {
  broadcaster.close();
  httpServer.close();
});

describe('WebSocket Integration', () => {
  describe('connection lifecycle', () => {
    it('receives snapshot on connect', async () => {
      const c = await connectClient();
      const msg = await c.waitFor((m) => m.type === 'snapshot');
      expect(msg.type).toBe('snapshot');
      if (msg.type === 'snapshot') {
        expect(Array.isArray(msg.agents)).toBe(true);
        expect(Array.isArray(msg.recentEvents)).toBe(true);
      }
      await c.close();
    });

    it('responds to ping with heartbeat', async () => {
      const c = await connectClient();
      await c.drainSnapshot();
      c.send({ type: 'ping' });
      const msg = await c.waitFor((m) => m.type === 'system:heartbeat');
      expect(msg.type).toBe('system:heartbeat');
      await c.close();
    });

    it('responds to request:snapshot', async () => {
      const c = await connectClient();
      await c.drainSnapshot();
      c.send({ type: 'request:snapshot' });
      const msg = await c.waitFor((m) => m.type === 'snapshot');
      expect(msg.type).toBe('snapshot');
      await c.close();
    });

    it('ignores malformed messages without crashing', async () => {
      const c = await connectClient();
      await c.drainSnapshot();
      c.ws.send('not json');
      c.ws.send(JSON.stringify({ type: 'unknown_type' }));
      c.send({ type: 'ping' });
      const msg = await c.waitFor((m) => m.type === 'system:heartbeat');
      expect(msg.type).toBe('system:heartbeat');
      await c.close();
    });
  });

  describe('event → broadcast flow', () => {
    it('broadcasts agent:spawn on SessionStart', async () => {
      const c = await connectClient();
      await c.drainSnapshot();
      await postEvent('SessionStart', 'ws-flow-1');
      const msg = await c.waitFor((m) => m.type === 'agent:spawn');
      expect(msg.type).toBe('agent:spawn');
      if (msg.type === 'agent:spawn') {
        expect(msg.agent.sessionId).toBe('ws-flow-1');
      }
      await c.close();
    });

    it('broadcasts agent:state on tool use', async () => {
      const c = await connectClient();
      await c.drainSnapshot();
      await postEvent('PreToolUse', 'ws-flow-1', { tool_name: 'Write' });
      const msg = await c.waitFor((m) => m.type === 'agent:state');
      expect(msg.type).toBe('agent:state');
      if (msg.type === 'agent:state') {
        expect(msg.sessionId).toBe('ws-flow-1');
        expect(msg.state).toBe('active');
        expect(msg.tool).toBe('Write');
        expect(msg.animation).toBe('typing');
      }
      await c.close();
    });

    it('broadcasts agent:despawn on SessionEnd', async () => {
      const c = await connectClient();
      await c.drainSnapshot();
      await postEvent('SessionEnd', 'ws-flow-1');
      const msg = await c.waitFor((m) => m.type === 'agent:despawn');
      expect(msg.type).toBe('agent:despawn');
      if (msg.type === 'agent:despawn') {
        expect(msg.sessionId).toBe('ws-flow-1');
      }
      await c.close();
    });

    it('broadcasts agent:rename', async () => {
      await postEvent('SessionStart', 'ws-rename-1');
      const c = await connectClient();
      await c.drainSnapshot();
      await fetch(`${baseUrl}/api/agents/ws-rename-1/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TestAgent' }),
      });
      const msg = await c.waitFor((m) => m.type === 'agent:rename');
      expect(msg.type).toBe('agent:rename');
      if (msg.type === 'agent:rename') {
        expect(msg.sessionId).toBe('ws-rename-1');
        expect(msg.name).toBe('TestAgent');
      }
      await c.close();
    });
  });

  describe('sub-agent flow', () => {
    it('broadcasts sub-agent spawn with parentId', async () => {
      await postEvent('SessionStart', 'ws-parent-1');
      const c = await connectClient();
      await c.drainSnapshot();
      await postEvent('SubagentStart', 'ws-parent-1', { agent_id: 'ws-sub-1', agent_type: 'Explore' });
      const msg = await c.waitFor((m) =>
        m.type === 'agent:spawn' && 'agent' in m && m.agent.sessionId === 'ws-sub-1'
      );
      if (msg.type === 'agent:spawn') {
        expect(msg.agent.parentId).toBe('ws-parent-1');
        expect(msg.agent.displayName).toBe('Explore');
      }
      await c.close();
    });
  });

  describe('multiple clients', () => {
    it('broadcasts to all connected clients', async () => {
      const c1 = await connectClient();
      const c2 = await connectClient();
      await c1.drainSnapshot();
      await c2.drainSnapshot();

      await postEvent('SessionStart', 'ws-multi-1');

      const [msg1, msg2] = await Promise.all([
        c1.waitFor((m) => m.type === 'agent:spawn'),
        c2.waitFor((m) => m.type === 'agent:spawn'),
      ]);
      expect(msg1.type).toBe('agent:spawn');
      expect(msg2.type).toBe('agent:spawn');

      await Promise.all([c1.close(), c2.close()]);
    });

    it('reports correct client count', async () => {
      // Wait for any lingering connections to close
      await new Promise((r) => setTimeout(r, 100));
      const before = broadcaster.getClientCount();
      const c = await connectClient();
      await c.drainSnapshot();
      expect(broadcaster.getClientCount()).toBeGreaterThan(before);
      await c.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(broadcaster.getClientCount()).toBe(before);
    });
  });

  describe('connection limit', () => {
    it('rejects connections beyond maxClients', async () => {
      const clients: TestClient[] = [];
      const currentCount = broadcaster.getClientCount();
      const toOpen = 50 - currentCount;

      for (let i = 0; i < toOpen; i++) {
        const c = await connectClient();
        await c.drainSnapshot();
        clients.push(c);
      }
      expect(broadcaster.getClientCount()).toBe(50);

      // Next connection should be rejected with code 1013
      const rejected = new WebSocket(wsUrl);
      const closeCode = await new Promise<number>((resolve) => {
        rejected.on('close', (code) => resolve(code));
      });
      expect(closeCode).toBe(1013);

      await Promise.all(clients.map((c) => c.close()));
      await new Promise((r) => setTimeout(r, 100));
    });
  });
});
