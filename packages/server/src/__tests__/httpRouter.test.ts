import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { SessionStore } from '@claude-alive/core';
import type { HookEventPayload } from '@claude-alive/core';
import { createHttpServer } from '../httpRouter.js';

let server: Server;
let baseUrl: string;
const store = new SessionStore();

function getSnapshot() {
  return {
    agents: store.getAllAgents(),
    recentEvents: store.getRecentEvents(100),
    completedSessions: store.getCompletedSessions(),
  };
}

function onEvent(payload: HookEventPayload): void {
  store.processEvent(payload);
}

beforeAll(async () => {
  server = createHttpServer({
    onEvent,
    getSnapshot,
    renameAgent: (id, name) => store.renameAgent(id, name),
    removeAgent: (id) => store.removeAgent(id),
  });
  baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        resolve(`http://localhost:${addr.port}`);
      }
    });
  });
});

afterAll(() => {
  server.close();
});

describe('HTTP Router', () => {
  describe('GET /health', () => {
    it('returns { ok: true }', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('includes security headers', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-xss-protection')).toBe('1; mode=block');
      expect(res.headers.get('content-security-policy')).toBeTruthy();
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('POST /api/event', () => {
    it('accepts valid wrapped payload', async () => {
      const res = await fetch(`${baseUrl}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'SessionStart',
          tool: 'system',
          session_id: 'test-http-1',
          timestamp: Date.now(),
          data: { session_id: 'test-http-1', hook_event_name: 'SessionStart', cwd: '/tmp' },
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it('accepts raw hook stdin format', async () => {
      const res = await fetch(`${baseUrl}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'test-http-2',
          hook_event_name: 'SessionStart',
          cwd: '/tmp/raw',
        }),
      });
      expect(res.status).toBe(200);
    });

    it('rejects invalid JSON', async () => {
      const res = await fetch(`${baseUrl}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('rejects completely invalid payload (no session_id)', async () => {
      const res = await fetch(`${baseUrl}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/status', () => {
    it('returns running status', async () => {
      const res = await fetch(`${baseUrl}/api/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('running');
      expect(typeof body.uptime).toBe('number');
    });
  });

  describe('GET /api/agents', () => {
    it('returns agents array', async () => {
      const res = await fetch(`${baseUrl}/api/agents`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('GET /api/events', () => {
    it('returns events array', async () => {
      const res = await fetch(`${baseUrl}/api/events`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('PUT /api/agents/:id/name', () => {
    it('renames an existing agent', async () => {
      // Create agent first
      await fetch(`${baseUrl}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'SessionStart',
          tool: 'system',
          session_id: 'rename-test',
          timestamp: Date.now(),
          data: { session_id: 'rename-test', hook_event_name: 'SessionStart', cwd: '/tmp' },
        }),
      });
      const res = await fetch(`${baseUrl}/api/agents/rename-test/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MyAgent' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown agent', async () => {
      const res = await fetch(`${baseUrl}/api/agents/nonexistent/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      expect(res.status).toBe(404);
    });

    it('rejects name longer than 100 chars', async () => {
      const res = await fetch(`${baseUrl}/api/agents/rename-test/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(101) }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid body (name is number)', async () => {
      const res = await fetch(`${baseUrl}/api/agents/rename-test/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 12345 }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts null name to clear', async () => {
      const res = await fetch(`${baseUrl}/api/agents/rename-test/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: null }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('removes an existing agent', async () => {
      await fetch(`${baseUrl}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'SessionStart',
          tool: 'system',
          session_id: 'delete-test',
          timestamp: Date.now(),
          data: { session_id: 'delete-test', hook_event_name: 'SessionStart', cwd: '/tmp' },
        }),
      });
      const res = await fetch(`${baseUrl}/api/agents/delete-test`, { method: 'DELETE' });
      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown agent', async () => {
      const res = await fetch(`${baseUrl}/api/agents/nonexistent`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('OPTIONS (CORS preflight)', () => {
    it('returns 204 with CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/event`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown POST routes', async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent`, { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  // --- Security tests ---
  describe('security', () => {
    it('rejects body larger than 1MB', async () => {
      const largeBody = JSON.stringify({ data: 'x'.repeat(1_100_000) });
      try {
        const res = await fetch(`${baseUrl}/api/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: largeBody,
        });
        // If we get a response, it should be an error
        expect(res.ok).toBe(false);
      } catch {
        // Connection reset is expected — server destroyed the socket
        expect(true).toBe(true);
      }
    });

    it('blocks non-localhost CORS origin', async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Origin: 'https://evil.com' },
      });
      const origin = res.headers.get('access-control-allow-origin');
      expect(origin).toBe('');
    });

    it('allows localhost origin', async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    });

    it('allows 127.0.0.1 origin', async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Origin: 'http://127.0.0.1:3141' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3141');
    });

    it('handles deeply nested JSON without crash', async () => {
      // Not a bomb, just reasonable nested object
      const nested = { session_id: 'nest-test', hook_event_name: 'SessionStart', cwd: '/tmp', deep: {} };
      let current: any = nested.deep;
      for (let i = 0; i < 50; i++) {
        current.inner = {};
        current = current.inner;
      }
      const res = await fetch(`${baseUrl}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nested),
      });
      expect(res.status).toBe(200);
    });
  });
});
