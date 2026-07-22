import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { HookEventPayload, HookEventData, HookEventName } from '@claude-alive/core';
import { createStaticHandler } from './staticFiles.js';
import { listClaudeSessions } from './claudeSessionIndex.js';
import type { EfficioReader } from './efficioReader.js';

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
  /** Durable archive of completed (terminated) sessions, newest first. */
  getCompletedArchive: () => unknown[];
  /** Project-name persistence wiring. */
  getProjectNames: () => Record<string, string>;
  saveProjectName: (cwd: string, name: string) => Promise<void>;
  removeProjectName: (cwd: string) => Promise<void>;
  /** Called after a project name changes so the server can broadcast the new map over WS. */
  onProjectNamesChanged?: () => void;
  /** Path to the UI dist directory. Defaults to ../../ui/dist relative to server dist. */
  uiDistPath?: string;
  /**
   * Optional read-only bridge to the efficio SQLite store. When present,
   * `/api/efficio/*` routes serve pre-computed efficiency scores. Absent or
   * data-less → routes return `available:false` so the UI can guide `collect`.
   */
  efficio?: EfficioReader;
  /**
   * Optional sub-router for paths owned by the absorbed think-prompt
   * subsystem (`/api/prompts*`, `/api/sessions*`, `/v1/ingest/*`). When
   * present, requests matching those prefixes are delegated to it before
   * the built-in route table is consulted — Fastify mounted on the same
   * http.Server with no second port.
   */
  promptRouter?: (req: IncomingMessage, res: ServerResponse) => void;

  /**
   * Server-owned canonical catalog (§I.5). Absent when the v2 event log could
   * not start, in which case the route reports that explicitly rather than
   * pretending the tree is empty.
   */
  workspaceTree?: () => unknown;

  /** One session's conversation; null when the session is unknown (§F.7). */
  sessionConversation?: (sessionId: string, cursor: number) => unknown | null;

  /** Whether a server-owned terminal exists for the session, and why not (§F.7). */
  sessionTerminal?: (sessionId: string) => unknown;

  /**
   * Ticket dashboard wiring (spec 2026-07-21). Absent when the ticket subsystem
   * is disabled, in which case `/api/tickets*` routes 404.
   */
  tickets?: {
    list: () => unknown[];
    create: (input: {
      goal: string;
      cwd: string;
      location?: {
        kind: 'local' | 'ssh';
        ssh?: { host: string; user?: string; port?: number; identityFile?: string };
        label?: string;
      };
      orchestrated?: boolean;
    }) => Promise<unknown>;
    retry: (id: string) => Promise<unknown | undefined>;
    /** Continue a `decision` ticket with a follow-up prompt. Undefined = unknown id. */
    reply?: (id: string, prompt: string) => Promise<unknown | undefined>;
    cancel: (id: string) => Promise<unknown | undefined>;
    remove: (id: string) => Promise<boolean>;
    /** Validate cwd before creating; returns an error message, or null when valid. */
    validateCwd?: (cwd: string, isRemote: boolean) => string | null;
    /** Apply a human good/bad label to a settled ticket. Undefined = unknown id. */
    evaluate?: (
      id: string,
      input: { label: 'good' | 'bad' | 'unrated'; weight?: number; note?: string },
    ) => Promise<unknown | undefined>;
    /** All evaluation records (dataset), newest activity first is up to the caller. */
    listEvaluations?: () => unknown[];
  };

  /**
   * Orchestration backend registry (spec 2026-07-22). Absent when disabled.
   * Powers the onboarding surface: list connectable backends + live check.
   */
  backends?: {
    list: () => unknown[];
    check: (id: string) => Promise<unknown | null>;
  };

  /** Remote directory listing over SSH, for the ticket's remote folder picker. */
  sshBrowse?: (
    target: { host: string; user?: string; port?: number; identityFile?: string },
    path?: string,
  ) => Promise<unknown>;
}

const ProjectNameBodySchema = z.object({
  cwd: z.string().min(1),
  name: z.string().max(100).nullable(),
});

// Reject values starting with `-` at the boundary: they would be smuggled to
// `ssh` as options (argv flag injection, e.g. `-oProxyCommand=…`). sshExecutor
// re-checks defensively, but the schema is the first line of defence.
const noLeadingDash = /^[^-]/;
const SshTargetSchema = z.object({
  host: z.string().min(1).max(255).regex(noLeadingDash),
  user: z.string().max(64).regex(noLeadingDash).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().max(1024).regex(noLeadingDash).optional(),
});

const TicketLocationSchema = z.object({
  kind: z.enum(['local', 'ssh']),
  ssh: SshTargetSchema.optional(),
  label: z.string().max(120).optional(),
});

const TicketCreateBodySchema = z.object({
  goal: z.string().min(1).max(8000),
  cwd: z.string().min(1),
  location: TicketLocationSchema.optional(),
  orchestrated: z.boolean().optional(),
});

const EvaluateBodySchema = z.object({
  label: z.enum(['good', 'bad', 'unrated']),
  weight: z.number().int().min(1).max(5).optional(),
  note: z.string().max(2000).optional(),
});

const MAX_BODY_BYTES = 1_048_576; // 1 MB

/**
 * Ticket routes spawn fully-autonomous agents (RCE-equivalent), so they are
 * restricted to loopback callers regardless of what interface the server bound.
 * Covers IPv4, IPv6, and IPv4-mapped-IPv6 loopback.
 */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

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
  const {
    onEvent,
    getSnapshot,
    renameAgent,
    removeAgent,
    getStats,
    getCompletedArchive,
    getProjectNames,
    saveProjectName,
    removeProjectName,
    onProjectNamesChanged,
    uiDistPath,
    promptRouter,
    workspaceTree,
    sessionConversation,
    sessionTerminal,
    efficio,
    tickets,
    backends,
    sshBrowse,
  } = options;
  const serveStatic = createStaticHandler(uiDistPath);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Delegate prompt-subsystem paths to the mounted Fastify router first.
    // These paths are exclusively owned by the absorbed think-prompt code
    // (read-only JSON API + browser-extension ingest); the built-in router
    // never registers them, so there is no overlap risk.
    if (
      promptRouter &&
      (url.pathname.startsWith('/api/prompts') ||
        url.pathname.startsWith('/api/sessions') ||
        url.pathname.startsWith('/v1/ingest/'))
    ) {
      promptRouter(req, res);
      return;
    }

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, null, req);
      return;
    }

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

    // v2 read model. Separate from /api/status (v1) so the two can be compared
    // during the dual-write period instead of one silently replacing the other.
    if (req.method === 'GET' && url.pathname === '/api/v2/workspace-tree') {
      if (!workspaceTree) {
        sendJson(res, 503, { error: 'canonical event log unavailable', detail: 'see server logs' }, req);
        return;
      }
      sendJson(res, 200, workspaceTree(), req);
      return;
    }

    const terminalMatch = url.pathname.match(/^\/api\/v2\/sessions\/([^/]+)\/terminal$/);
    if (req.method === 'GET' && terminalMatch) {
      if (!sessionTerminal) {
        sendJson(res, 503, { error: 'canonical event log unavailable', detail: 'see server logs' }, req);
        return;
      }
      sendJson(res, 200, sessionTerminal(decodeURIComponent(terminalMatch[1])), req);
      return;
    }

    const conversationMatch = url.pathname.match(/^\/api\/v2\/sessions\/([^/]+)\/conversation$/);
    if (req.method === 'GET' && conversationMatch) {
      if (!sessionConversation) {
        sendJson(res, 503, { error: 'canonical event log unavailable', detail: 'see server logs' }, req);
        return;
      }
      const cursor = Number(url.searchParams.get('cursor') ?? '0');
      const page = sessionConversation(
        decodeURIComponent(conversationMatch[1]),
        Number.isFinite(cursor) ? cursor : 0,
      );
      if (!page) {
        sendJson(res, 404, { error: 'unknown session' }, req);
        return;
      }
      sendJson(res, 200, page, req);
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

    // ── Ticket dashboard (spec 2026-07-21) ──────────────────────────────────
    // These routes drive RCE-equivalent autonomous agents → loopback callers only.
    if (tickets && url.pathname.startsWith('/api/tickets') && !isLoopbackRequest(req)) {
      sendJson(res, 403, { error: 'Ticket API is restricted to loopback' }, req);
      return;
    }
    if (tickets && req.method === 'GET' && url.pathname === '/api/tickets') {
      sendJson(res, 200, { tickets: tickets.list() }, req);
      return;
    }
    if (tickets && req.method === 'POST' && url.pathname === '/api/tickets') {
      try {
        const parsed = TicketCreateBodySchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: goal and cwd are required' }, req);
          return;
        }
        const cwdError = tickets.validateCwd?.(parsed.data.cwd, parsed.data.location?.kind === 'ssh');
        if (cwdError) {
          sendJson(res, 400, { error: cwdError }, req);
          return;
        }
        const ticket = await tickets.create(parsed.data);
        sendJson(res, 201, { ticket }, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }
    const ticketRetryMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/retry$/);
    if (tickets && req.method === 'POST' && ticketRetryMatch) {
      const ticket = await tickets.retry(ticketRetryMatch[1]!);
      sendJson(res, ticket ? 200 : 404, ticket ? { ticket } : { error: 'Ticket not found' }, req);
      return;
    }
    const ticketCancelMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/cancel$/);
    if (tickets && req.method === 'POST' && ticketCancelMatch) {
      const ticket = await tickets.cancel(ticketCancelMatch[1]!);
      sendJson(res, ticket ? 200 : 404, ticket ? { ticket } : { error: 'Ticket not found' }, req);
      return;
    }
    // POST /api/tickets/:id/reply — follow-up prompt for a decision ticket.
    const ticketReplyMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/reply$/);
    if (tickets?.reply && req.method === 'POST' && ticketReplyMatch) {
      try {
        const parsed = JSON.parse(await readBody(req)) as { prompt?: unknown };
        const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
        if (!prompt) {
          sendJson(res, 400, { error: 'Invalid body: prompt is required' }, req);
          return;
        }
        const ticket = await tickets.reply(ticketReplyMatch[1]!, prompt);
        sendJson(res, ticket ? 200 : 404, ticket ? { ticket } : { error: 'Ticket not found' }, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }
    // POST /api/tickets/:id/evaluate — human good/bad label. Under the /api/tickets
    // prefix so the loopback guard above already applies.
    const ticketEvalMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/evaluate$/);
    if (tickets?.evaluate && req.method === 'POST' && ticketEvalMatch) {
      try {
        const parsed = EvaluateBodySchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: label must be good|bad|unrated' }, req);
          return;
        }
        const evaluation = await tickets.evaluate(ticketEvalMatch[1]!, parsed.data);
        sendJson(res, evaluation ? 200 : 404, evaluation ? { evaluation } : { error: 'Ticket not found' }, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }
    const ticketDeleteMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (tickets && req.method === 'DELETE' && ticketDeleteMatch) {
      const ok = await tickets.remove(ticketDeleteMatch[1]!);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Ticket not found' }, req);
      return;
    }

    // GET /api/evaluations — the evaluation dataset (read-only). Loopback-only:
    // it echoes ticket content (goals/results), matching the /api/tickets guard.
    if (tickets?.listEvaluations && req.method === 'GET' && url.pathname === '/api/evaluations') {
      if (!isLoopbackRequest(req)) {
        sendJson(res, 403, { error: 'Evaluation API is restricted to loopback' }, req);
        return;
      }
      sendJson(res, 200, { evaluations: tickets.listEvaluations() }, req);
      return;
    }

    // Orchestration backends (loopback-only): list + live connectivity check.
    if (backends && req.method === 'GET' && url.pathname === '/api/backends') {
      if (!isLoopbackRequest(req)) {
        sendJson(res, 403, { error: 'Backends API is restricted to loopback' }, req);
        return;
      }
      sendJson(res, 200, { backends: backends.list() }, req);
      return;
    }
    // POST /api/ssh/browse — list remote sub-directories for the remote folder
    // picker (loopback-only; the ssh target comes from the local user's preset).
    if (sshBrowse && req.method === 'POST' && url.pathname === '/api/ssh/browse') {
      if (!isLoopbackRequest(req)) {
        sendJson(res, 403, { error: 'SSH browse is restricted to loopback' }, req);
        return;
      }
      try {
        const parsed = z
          .object({ ssh: SshTargetSchema, path: z.string().max(4096).optional() })
          .safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: ssh target required' }, req);
          return;
        }
        const result = await sshBrowse(parsed.data.ssh, parsed.data.path);
        sendJson(res, 200, result, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }
    const backendCheckMatch = url.pathname.match(/^\/api\/backends\/([^/]+)\/check$/);
    if (backends && req.method === 'POST' && backendCheckMatch) {
      if (!isLoopbackRequest(req)) {
        sendJson(res, 403, { error: 'Backends API is restricted to loopback' }, req);
        return;
      }
      const status = await backends.check(backendCheckMatch[1]!);
      sendJson(res, status ? 200 : 404, status ? { status } : { error: 'Unknown backend' }, req);
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

    // GET /api/completed?limit=500 — durable archive of terminated sessions, newest first.
    if (req.method === 'GET' && url.pathname === '/api/completed') {
      const all = getCompletedArchive();
      const limitParam = parseInt(url.searchParams.get('limit') ?? '', 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 2000) : 500;
      sendJson(res, 200, { sessions: all.slice(0, limit) }, req);
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

    // GET /api/projects/names — full cwd→name map
    if (req.method === 'GET' && url.pathname === '/api/projects/names') {
      sendJson(res, 200, { names: getProjectNames() }, req);
      return;
    }

    // PUT /api/projects/names — body: { cwd, name: string | null }
    // null name removes the entry. Broadcasts the new map over WS so every client stays in sync.
    if (req.method === 'PUT' && url.pathname === '/api/projects/names') {
      try {
        const body = await readBody(req);
        const parsed = ProjectNameBodySchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body' }, req);
          return;
        }
        const { cwd, name } = parsed.data;
        if (name === null) {
          await removeProjectName(cwd);
        } else {
          await saveProjectName(cwd, name);
        }
        onProjectNamesChanged?.();
        sendJson(res, 200, { names: getProjectNames() }, req);
      } catch {
        sendJson(res, 500, { error: 'Failed to save project name' }, req);
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

    // GET /api/efficio/status — data availability + active reference model meta
    if (req.method === 'GET' && url.pathname === '/api/efficio/status') {
      const status = efficio
        ? efficio.status()
        : { available: false, sessionCount: 0, modelVersion: null, modelN: null, lastScoredAt: null };
      sendJson(res, 200, status, req);
      return;
    }

    // GET /api/efficio/timeline?axis=w2&last=20 — size-adjusted waste residual series
    if (req.method === 'GET' && url.pathname === '/api/efficio/timeline') {
      const axis = url.searchParams.get('axis') ?? 'w2';
      const last = parseInt(url.searchParams.get('last') ?? '20', 10);
      const timeline = efficio ? efficio.timeline(axis, last) : { axis: 'w2', rows: [] };
      sendJson(res, 200, timeline, req);
      return;
    }

    // GET /api/efficio/profiles?last=60 — per-session 4-axis profiles + size (full dashboard)
    if (req.method === 'GET' && url.pathname === '/api/efficio/profiles') {
      const last = parseInt(url.searchParams.get('last') ?? '60', 10);
      const profiles = efficio ? efficio.profiles(last) : { modelVersion: null, sessions: [] };
      sendJson(res, 200, profiles, req);
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
