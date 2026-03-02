import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { SessionStore } from '@claude-alive/core';
import type { HookEventPayload } from '@claude-alive/core';
import { createHttpServer } from '../httpRouter.js';
import { WSBroadcaster } from '../wsServer.js';

let httpServer: Server;
let broadcaster: WSBroadcaster;
let baseUrl: string;
const store = new SessionStore(5000, 200);

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
  if (payload.event === 'SessionStart') {
    broadcaster.broadcast({ type: 'agent:spawn', agent });
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

function postEvent(event: string, sessionId: string, extra: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      tool: extra.tool_name ?? 'system',
      session_id: sessionId,
      timestamp: Date.now(),
      data: { session_id: sessionId, hook_event_name: event, cwd: '/tmp/load', ...extra },
    }),
  });
}

beforeAll(async () => {
  httpServer = createHttpServer({
    onEvent,
    getSnapshot,
    renameAgent: (id, name) => store.renameAgent(id, name),
    removeAgent: (id) => store.removeAgent(id),
  });
  broadcaster = new WSBroadcaster(httpServer, { getSnapshot, maxClients: 50 });
  baseUrl = await new Promise<string>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      if (typeof addr === 'object' && addr) resolve(`http://localhost:${addr.port}`);
    });
  });
});

afterAll(() => {
  broadcaster.close();
  httpServer.close();
});

describe('Load Tests', () => {
  it('handles 100 concurrent session starts', async () => {
    const promises = Array.from({ length: 100 }, (_, i) =>
      postEvent('SessionStart', `load-sess-${i}`)
    );
    const results = await Promise.all(promises);
    const allOk = results.every((r) => r.status === 200);
    expect(allOk).toBe(true);

    const agents = store.getAllAgents();
    const loadAgents = agents.filter((a) => a.sessionId.startsWith('load-sess-'));
    expect(loadAgents.length).toBe(100);
  });

  it('handles rapid event bursts (500 events)', async () => {
    const sessionId = 'burst-session';
    await postEvent('SessionStart', sessionId);

    const events = Array.from({ length: 500 }, () =>
      postEvent('PreToolUse', sessionId, { tool_name: 'Write' })
    );
    const results = await Promise.all(events);
    const allOk = results.every((r) => r.status === 200);
    expect(allOk).toBe(true);

    const agent = store.getAgent(sessionId);
    expect(agent).toBeDefined();
    expect(agent!.totalEvents).toBeGreaterThanOrEqual(500);
  });

  it('handles many agent lifecycle cycles', async () => {
    for (let i = 0; i < 50; i++) {
      const id = `lifecycle-${i}`;
      await postEvent('SessionStart', id);
      await postEvent('PreToolUse', id, { tool_name: 'Read' });
      await postEvent('PostToolUse', id, { tool_name: 'Read' });
      await postEvent('Stop', id);
      await postEvent('SessionEnd', id);
    }
    // All lifecycle agents should be in despawning state (or cleaned up)
    const remaining = store.getAllAgents().filter((a) => a.sessionId.startsWith('lifecycle-'));
    for (const agent of remaining) {
      expect(agent.state).toBe('despawning');
    }
  });

  it('maintains event log within limits under load', () => {
    // After all the load tests, the event log should be capped
    const events = store.getRecentEvents(10000);
    expect(events.length).toBeLessThanOrEqual(5000);
  });

  it('GET /api/agents responds quickly with many agents', async () => {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/agents`);
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    const agents = await res.json();
    expect(agents.length).toBeGreaterThan(50);
    // Should respond within 200ms even with many agents
    expect(elapsed).toBeLessThan(200);
  });

  it('GET /api/events responds quickly under load', async () => {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/events`);
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(200);
  });
});
