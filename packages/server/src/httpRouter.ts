import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { HookEventPayload, HookEventData, HookEventName } from '@claude-alive/core';
import { createStaticHandler } from './staticFiles.js';
import { listClaudeSessions } from './claudeSessionIndex.js';

// --- Zod schemas for runtime input validation ---

const HookEventDataSchema = z.object({
  session_id: z.string(),
  hook_event_name: z.string(),
  cwd: z.string().optional().default(''),
  tool_name: z.string().optional(),
  prompt: z.string().optional(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  transcript_path: z.string().optional(),
}).passthrough();

const WrappedPayloadSchema = z.object({
  event: z.string(),
  tool: z.string().optional().default('system'),
  session_id: z.string(),
  timestamp: z.number(),
  data: HookEventDataSchema,
});

const RenameBodySchema = z.object({
  name: z.string().max(100).nullable(),
});

/**
 * Normalize incoming event payload. Claude Code hook stdin sends raw
 * HookEventData ({ hook_event_name, session_id, ... }). Our wrapped format
 * adds { event, tool, timestamp, data }. Accept both.
 */
function normalizePayload(raw: Record<string, unknown>): HookEventPayload {
  // Try wrapped format first
  const wrapped = WrappedPayloadSchema.safeParse(raw);
  if (wrapped.success) {
    return wrapped.data as unknown as HookEventPayload;
  }

  // Try raw Claude Code hook stdin format
  const rawParsed = HookEventDataSchema.safeParse(raw);
  if (!rawParsed.success) {
    throw new Error('Invalid event payload');
  }

  const data = rawParsed.data as unknown as HookEventData;
  return {
    event: data.hook_event_name as HookEventName,
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
  getStats: () => object;
  /** Path to the UI dist directory. Defaults to ../../ui/dist relative to server dist. */
  uiDistPath?: string;
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

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
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(data));
}

export function createHttpServer(options: HttpRouterOptions) {
  const { onEvent, getSnapshot, renameAgent, removeAgent, getStats, uiDistPath } = options;
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
        sendJson(res, 400, { error: 'Invalid payload' }, req);
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
        const parsed = RenameBodySchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: name must be a string (max 100 chars) or null' }, req);
          return;
        }
        const ok = renameAgent(renameMatch[1]!, parsed.data.name);
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

    if (req.method === 'GET' && url.pathname === '/api/stats') {
      sendJson(res, 200, getStats(), req);
      return;
    }

    // GET /api/fs/browse?dir=/path — list directories for folder picker
    if (req.method === 'GET' && url.pathname === '/api/fs/browse') {
      try {
        const rawDir = url.searchParams.get('dir') || '~';
        const dir = rawDir.startsWith('~') ? pathResolve(homedir(), rawDir.slice(1).replace(/^\//, '')) : pathResolve(rawDir);
        const entries = await readdir(dir, { withFileTypes: true });
        const dirs: { name: string; path: string }[] = [];
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            dirs.push({ name: entry.name, path: pathResolve(dir, entry.name) });
          }
        }
        dirs.sort((a, b) => a.name.localeCompare(b.name));
        sendJson(res, 200, { path: dir, dirs, isRoot: dir === '/' }, req);
      } catch {
        sendJson(res, 400, { error: 'Cannot read directory' }, req);
      }
      return;
    }

    // GET /api/claude/sessions?cwd=/abs/path — list past Claude sessions for a project
    if (req.method === 'GET' && url.pathname === '/api/claude/sessions') {
      try {
        const cwd = url.searchParams.get('cwd');
        if (!cwd) {
          sendJson(res, 400, { error: 'cwd query parameter required' }, req);
          return;
        }
        const sessions = await listClaudeSessions(cwd);
        sendJson(res, 200, { sessions }, req);
      } catch {
        sendJson(res, 500, { error: 'Failed to list sessions' }, req);
      }
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
