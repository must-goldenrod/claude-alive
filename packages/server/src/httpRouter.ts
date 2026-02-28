import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HookEventPayload, HookEventData } from '@claude-alive/core';
import { createStaticHandler } from './staticFiles.js';

/**
 * Normalize incoming event payload. Claude Code hook stdin sends raw
 * HookEventData ({ hook_event_name, session_id, ... }). Our wrapped format
 * adds { event, tool, timestamp, data }. Accept both.
 */
function normalizePayload(raw: Record<string, unknown>): HookEventPayload {
  // Already in wrapped format
  if (raw.event && raw.data) {
    return raw as unknown as HookEventPayload;
  }

  // Raw Claude Code hook stdin — wrap it
  const data = raw as unknown as HookEventData;
  return {
    event: data.hook_event_name,
    tool: data.tool_name ?? 'system',
    session_id: data.session_id,
    timestamp: Date.now(),
    data,
  };
}

export interface HttpRouterOptions {
  onEvent: (payload: HookEventPayload) => void;
  getSnapshot: () => object;
  renameAgent: (sessionId: string, name: string | null) => boolean;
  removeAgent: (sessionId: string) => boolean;
  /** Path to the UI dist directory. Defaults to ../../ui/dist relative to server dist. */
  uiDistPath?: string;
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLen = 0;
    req.on('data', (chunk: Buffer) => {
      totalLen += chunk.length;
      if (totalLen > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown, req?: IncomingMessage): void {
  const origin = req?.headers.origin;
  const allowedOrigin = isLocalOrigin(origin) ? (origin ?? 'http://localhost') : '';
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

export function createHttpServer(options: HttpRouterOptions) {
  const { onEvent, getSnapshot, renameAgent, removeAgent, uiDistPath } = options;
  const serveStatic = createStaticHandler(uiDistPath);

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, null, req);
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/event') {
      try {
        const body = await readBody(req);
        const raw = JSON.parse(body) as Record<string, unknown>;
        const payload = normalizePayload(raw);
        onEvent(payload);
        sendJson(res, 200, { ok: true }, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, 200, {
        status: 'running',
        version: '0.1.0',
        uptime: process.uptime(),
        ...getSnapshot(),
      }, req);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      const snapshot = getSnapshot() as { agents?: unknown };
      sendJson(res, 200, snapshot.agents ?? [], req);
      return;
    }

    // PUT /api/agents/:id/name — rename an agent
    const renameMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/name$/);
    if (req.method === 'PUT' && renameMatch) {
      try {
        const body = await readBody(req);
        const { name } = JSON.parse(body) as { name: string | null };
        const ok = renameAgent(renameMatch[1]!, name);
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Agent not found' }, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }

    // DELETE /api/agents/:id — remove an agent
    const deleteMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      const ok = removeAgent(deleteMatch[1]!);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Agent not found' }, req);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const snapshot = getSnapshot() as { recentEvents?: unknown };
      sendJson(res, 200, snapshot.recentEvents ?? [], req);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true }, req);
      return;
    }

    // Static file serving + SPA fallback
    if (req.method === 'GET') {
      const served = await serveStatic(url.pathname, res);
      if (served) return;
    }

    sendJson(res, 404, { error: 'Not found' }, req);
  });

  return server;
}
