import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createHttpServer } from '../httpRouter.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createHttpServer({
    onEvent: () => {},
    getSnapshot: () => ({ agents: [], recentEvents: [], completedSessions: [], stats: {} }) as never,
    renameAgent: () => false,
    removeAgent: () => false,
    getStats: () => ({}) as never,
    tickets: {
      list: () => [],
      create: async (input) => ({ id: 't1', goal: input.goal, cwd: input.cwd }),
      retry: async () => undefined,
      cancel: async () => undefined,
      remove: async () => false,
    },
  });
  baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
});

afterAll(() => {
  server.close();
});

function createTicket(goal: string): Promise<Response> {
  return fetch(`${baseUrl}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, cwd: '/tmp' }),
  });
}

describe('POST /api/tickets body limits', () => {
  it('accepts a goal far longer than the former 8k cap', async () => {
    const res = await createTicket('a'.repeat(60_000));
    expect(res.status).toBe(201);
  });

  it('rejects a goal past the 100k character cap', async () => {
    const res = await createTicket('a'.repeat(100_001));
    expect(res.status).toBe(400);
  });

  it('answers 413 instead of dropping the connection when the body exceeds 1 MB', async () => {
    const res = await createTicket('a'.repeat(1_100_000));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: expect.stringContaining('Payload too large') });
  });
});
