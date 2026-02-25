import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HookEventPayload } from '@claude-alive/core';

export interface HttpRouterOptions {
  onEvent: (payload: HookEventPayload) => void;
  getSnapshot: () => object;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

export function createHttpServer(options: HttpRouterOptions) {
  const { onEvent, getSnapshot } = options;

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, null);
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/event') {
      try {
        const body = await readBody(req);
        const payload = JSON.parse(body) as HookEventPayload;
        onEvent(payload);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, 200, {
        status: 'running',
        version: '0.1.0',
        uptime: process.uptime(),
        ...getSnapshot(),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      const snapshot = getSnapshot() as { agents?: unknown };
      sendJson(res, 200, snapshot.agents ?? []);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const snapshot = getSnapshot() as { recentEvents?: unknown };
      sendJson(res, 200, snapshot.recentEvents ?? []);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  return server;
}
