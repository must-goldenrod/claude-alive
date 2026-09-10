import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir } from 'node:fs/promises';
import { isAbsolute, resolve as pathResolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { TICKET_RUN_PRESET_IDS } from '@claude-alive/core';
import type { HookEventPayload, HookEventData, HookEventName } from '@claude-alive/core';
import { createStaticHandler } from './staticFiles.js';
import { handleRunRequest } from './runRoutes.js';
import type { RunStore } from './runStore.js';
import { listClaudeSessions } from './claudeSessionIndex.js';
import {
  authorizeRequest,
  createAuthLimiter,
  type RemoteAccessConfig,
} from './remoteAccess.js';
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
  /**
   * ccusage-style LLM usage records parsed from raw Claude Code transcripts,
   * for the Tools > Data dashboard. Absent when the feature is disabled.
   */
  getUsageRecords?: () => Promise<unknown[]>;
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
  /**
   * Run registry (spec 2026-08-28). Absent when the subsystem is disabled, in
   * which case `/api/runs*` falls through to 404.
   */
  runs?: RunStore;

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
      autoCommit?: boolean;
      panelReview?: boolean;
    }) => Promise<unknown>;
    retry: (id: string) => Promise<unknown | undefined>;
    /** Continue a `decision` ticket with a follow-up prompt. Undefined = unknown id. */
    reply?: (id: string, prompt: string) => Promise<unknown | undefined>;
    cancel: (id: string) => Promise<unknown | undefined>;
    remove: (id: string) => Promise<boolean>;
    /** Validate cwd before creating; returns an error message, or null when valid. */
    validateCwd?: (cwd: string, isRemote: boolean) => string | null;
    /**
     * Extra validation applied only to tickets created by a remote device: the
     * cwd allowlist and the SSH-host policy. Returns an error message, or null.
     */
    validateRemoteCreate?: (input: { cwd: string; location?: { kind: string; ssh?: { host: string } } }) => string | null;
    /** Apply a human good/bad label to a settled ticket. Undefined = unknown id. */
    evaluate?: (
      id: string,
      input: { label: 'good' | 'bad' | 'unrated'; weight?: number; note?: string },
    ) => Promise<unknown | undefined>;
    /** Toggle the bias-reflection gate for a ticket. Undefined = unknown id. */
    setReflected?: (id: string, reflected: boolean) => Promise<unknown | undefined>;
    /** Synthesised RouteGuide (bias) preview for a route (cwd). */
    guideFor?: (route: string) => unknown;
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

  /**
   * Local git branch operations for the ticket composer. Absent when the git
   * subsystem is off, in which case `/api/git/*` 404s and the UI hides the
   * branch controls entirely.
   */
  git?: {
    list: (cwd: string) => Promise<unknown>;
    switch: (cwd: string, name: string) => Promise<unknown>;
    create: (cwd: string, name: string, from?: string) => Promise<unknown>;
    remove: (cwd: string, name: string) => Promise<unknown>;
  };

  /**
   * Remote-access policy. Absent = the pre-existing local-only behaviour.
   * Present and enabled, every request needs a token — including the ones that
   * arrive on loopback, because a tunnel makes remote callers look local.
   */
  remoteAccess?: RemoteAccessConfig;

  /**
   * Projects a remote caller may target, drawn from the ticket-root allowlist.
   * This exists because `/api/fs/browse` must stay closed to remote callers
   * (it reads any directory) while the app still has to offer a cwd to pick.
   */
  remoteProjects?: () => Promise<Array<{ path: string; name: string }>>;

  /** Branches of one allowlisted project, for the same reason as remoteProjects. */
  remoteBranches?: (cwd: string) => Promise<unknown>;

  /** Remote directory listing over SSH, for the ticket's remote folder picker. */
  sshBrowse?: (
    target: { host: string; user?: string; port?: number; identityFile?: string },
    path?: string,
  ) => Promise<unknown>;
}

// A leading `-` is the one character that turns a branch argument into a git
// flag. gitBranches rejects it too (and git itself rejects such a refname), but
// the boundary is where argv-shaped input should stop: an allowlist regex would
// be stricter and also reject the non-ASCII branch names git happily accepts.
const notAFlag = (v: string) => !v.startsWith('-');
const GitBranchBodySchema = z.object({
  cwd: z.string().min(1).refine(isAbsolute, 'cwd must be an absolute path'),
  name: z.string().min(1).max(200).refine(notAFlag, 'branch name must not start with "-"'),
  from: z.string().min(1).max(200).refine(notAFlag, 'start point must not start with "-"').optional(),
});

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

/**
 * Local runs pass the goal as an argv element (`claude -p <goal>`), so the cap
 * has to stay well under the OS argument limit (macOS kern.argmax = 1 MiB).
 * 100k chars is ~300 KB even in all-3-byte UTF-8 (Korean), leaving room for the
 * prompt prefix and the rest of the argv. The SSH executor feeds stdin instead
 * and is not bound by this.
 */
const MAX_GOAL_CHARS = 100_000;

const TicketCreateBodySchema = z.object({
  goal: z.string().min(1).max(MAX_GOAL_CHARS),
  cwd: z.string().min(1),
  location: TicketLocationSchema.optional(),
  orchestrated: z.boolean().optional(),
  // Opt out of the post-verification auto-commit. Omitted = on.
  autoCommit: z.boolean().optional(),
  // Opt out of the external review panels. Omitted = on.
  panelReview: z.boolean().optional(),
  // Closed enum, never free-form model/effort strings: the values become CLI
  // argv, so the allowlist lives at the boundary rather than downstream.
  preset: z.enum(TICKET_RUN_PRESET_IDS).optional(),
});

const EvaluateBodySchema = z.object({
  label: z.enum(['good', 'bad', 'unrated']),
  weight: z.number().int().min(1).max(5).optional(),
  note: z.string().max(2000).optional(),
  // Omitted, the bias gate follows the label; sent, it wins.
  reflected: z.boolean().optional(),
});

const ReflectBodySchema = z.object({
  reflected: z.boolean(),
});

const MAX_BODY_BYTES = 1_048_576; // 1 MB

/**
 * Policy for an install that never opted into remote access: loopback callers
 * are trusted, everyone else falls through to the per-route gates that answer
 * 403. Identical to the behaviour before remote mode existed.
 */
const REMOTE_DISABLED: RemoteAccessConfig = {
  enabled: false,
  host: '127.0.0.1',
  trustLoopback: false,
  tokens: [],
  ticketRoots: [],
  sshHosts: [],
  terminalLevel: 'off',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/**
 * Read a request body, capped at MAX_BODY_BYTES. On overflow the caller gets a
 * 413 (not a destroyed socket, which reaches the client as ECONNRESET and reads
 * like "the server is down"), and the rest of the body is drained so the
 * response can still be flushed. `res` is optional only for callers that have
 * already answered.
 */
function readBody(req: IncomingMessage, res?: ServerResponse): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLen = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return; // draining: keep reading, keep nothing
      totalLen += chunk.length;
      if (totalLen > MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0;
        if (res) sendJson(res, 413, { error: `Payload too large (max ${MAX_BODY_BYTES} bytes)` }, req);
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
  // The 413 from readBody answers first; the route's own catch must not follow it.
  if (res.headersSent || res.writableEnded) return;
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
    getUsageRecords,
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
    runs,
    tickets,
    backends,
    git,
    sshBrowse,
    remoteAccess,
    remoteProjects,
    remoteBranches,
  } = options;
  const serveStatic = createStaticHandler(uiDistPath);
  const accessPolicy = remoteAccess ?? REMOTE_DISABLED;
  // One limiter per server instance: the counter is what makes online token
  // guessing expensive, and it has to outlive individual requests.
  const authLimiter = createAuthLimiter();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Preflight carries no Authorization by definition, so it is answered
    // before the gate; it reveals nothing a 401 would not.
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, null, req);
      return;
    }

    // The access gate sits ahead of every route *and* ahead of the prompt
    // delegation below. Placing it after would leave `/api/prompts`,
    // `/api/sessions` and `/v1/ingest/*` — prompt text and a write path —
    // outside the policy entirely, since those return before the route table.
    const auth = authorizeRequest(
      {
        method: req.method ?? 'GET',
        pathname: url.pathname,
        headers: req.headers,
        remoteAddress: req.socket.remoteAddress,
        searchToken: url.searchParams.get('token') ?? undefined,
      },
      accessPolicy,
      authLimiter,
    );
    if (auth.kind === 'reject') {
      sendJson(res, auth.status, { error: auth.error }, req);
      return;
    }
    // What the per-route loopback checks below now ask. A remote caller only
    // gets here after clearing the route allowlist, so those checks must not
    // reject it a second time. `public` is the unauthenticated dashboard shell
    // and buys nothing beyond the static handler.
    const sensitiveAllowed = auth.kind === 'local' || auth.kind === 'token';
    const remoteCaller = auth.kind === 'token' && !auth.fullAccess;

    // Delegate prompt-subsystem paths to the mounted Fastify router.
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

    if (req.method === 'POST' && url.pathname === '/api/event') {
      try {
        const body = await readBody(req, res);
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
        const body = await readBody(req, res);
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

    // ── Run registry (spec 2026-08-28) ──────────────────────────────────────
    // Same loopback restriction as tickets: closing a run writes to disk.
    if (runs && url.pathname.startsWith('/api/runs')) {
      if (!sensitiveAllowed) {
        sendJson(res, 403, { error: 'Run API is restricted to loopback' }, req);
        return;
      }
      let parsedBody: unknown = null;
      if (req.method === 'POST') {
        try {
          parsedBody = JSON.parse(await readBody(req, res));
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON' }, req);
          return;
        }
      }
      const runResult = await handleRunRequest(runs, req.method ?? 'GET', url.pathname, parsedBody);
      if (runResult) {
        sendJson(res, runResult.status, runResult.body, req);
        return;
      }
    }

    // ── Ticket dashboard (spec 2026-07-21) ──────────────────────────────────
    // These routes drive RCE-equivalent autonomous agents → loopback callers only.
    if (tickets && url.pathname.startsWith('/api/tickets') && !sensitiveAllowed) {
      sendJson(res, 403, { error: '티켓 API 는 로컬(loopback) 호출만 허용됩니다' }, req);
      return;
    }
    if (tickets && req.method === 'GET' && url.pathname === '/api/tickets') {
      sendJson(res, 200, { tickets: tickets.list() }, req);
      return;
    }
    if (tickets && req.method === 'POST' && url.pathname === '/api/tickets') {
      try {
        const parsed = TicketCreateBodySchema.safeParse(JSON.parse(await readBody(req, res)));
        if (!parsed.success) {
          sendJson(res, 400, { error: '요청 형식 오류: goal 과 cwd 가 필요합니다' }, req);
          return;
        }
        const cwdError = tickets.validateCwd?.(parsed.data.cwd, parsed.data.location?.kind === 'ssh');
        if (cwdError) {
          sendJson(res, 400, { error: cwdError }, req);
          return;
        }
        // A device token may only start an agent where the operator said it
        // could. Checked at create time, not at spawn time, so the app gets a
        // real error instead of a ticket that fails minutes later.
        if (remoteCaller) {
          const remoteError = tickets.validateRemoteCreate?.(parsed.data);
          if (remoteError) {
            sendJson(res, 400, { error: remoteError }, req);
            return;
          }
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
      sendJson(res, ticket ? 200 : 404, ticket ? { ticket } : { error: '티켓을 찾을 수 없습니다' }, req);
      return;
    }
    const ticketCancelMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/cancel$/);
    if (tickets && req.method === 'POST' && ticketCancelMatch) {
      const ticket = await tickets.cancel(ticketCancelMatch[1]!);
      sendJson(res, ticket ? 200 : 404, ticket ? { ticket } : { error: '티켓을 찾을 수 없습니다' }, req);
      return;
    }
    // POST /api/tickets/:id/reply — follow-up prompt for a decision ticket.
    const ticketReplyMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/reply$/);
    if (tickets?.reply && req.method === 'POST' && ticketReplyMatch) {
      try {
        const parsed = JSON.parse(await readBody(req, res)) as { prompt?: unknown };
        const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
        if (!prompt) {
          sendJson(res, 400, { error: '요청 형식 오류: prompt 가 필요합니다' }, req);
          return;
        }
        const ticket = await tickets.reply(ticketReplyMatch[1]!, prompt);
        sendJson(res, ticket ? 200 : 404, ticket ? { ticket } : { error: '티켓을 찾을 수 없습니다' }, req);
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
        const parsed = EvaluateBodySchema.safeParse(JSON.parse(await readBody(req, res)));
        if (!parsed.success) {
          sendJson(res, 400, { error: '요청 형식 오류: label 은 good|bad|unrated 중 하나여야 합니다' }, req);
          return;
        }
        const evaluation = await tickets.evaluate(ticketEvalMatch[1]!, parsed.data);
        sendJson(res, evaluation ? 200 : 404, evaluation ? { evaluation } : { error: '티켓을 찾을 수 없습니다' }, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }
    // POST /api/tickets/:id/reflect — toggle the bias-reflection gate (opt-in).
    // Only reflected tickets shape the route's RouteGuide (spec 2026-07-22).
    const ticketReflectMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/reflect$/);
    if (tickets?.setReflected && req.method === 'POST' && ticketReflectMatch) {
      try {
        const parsed = ReflectBodySchema.safeParse(JSON.parse(await readBody(req, res)));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: reflected must be a boolean' }, req);
          return;
        }
        const evaluation = await tickets.setReflected(ticketReflectMatch[1]!, parsed.data.reflected);
        sendJson(res, evaluation ? 200 : 404, evaluation ? { evaluation } : { error: '티켓을 찾을 수 없습니다' }, req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' }, req);
      }
      return;
    }

    // GET /api/tickets/guide?route=<cwd> — current synthesised RouteGuide (bias)
    // for a route, so the ticket-management view can preview what is injected.
    if (tickets?.guideFor && req.method === 'GET' && url.pathname === '/api/tickets/guide') {
      const route = url.searchParams.get('route');
      if (!route) {
        sendJson(res, 400, { error: 'route query parameter required' }, req);
        return;
      }
      sendJson(res, 200, { guide: tickets.guideFor(route) }, req);
      return;
    }

    const ticketDeleteMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (tickets && req.method === 'DELETE' && ticketDeleteMatch) {
      const ok = await tickets.remove(ticketDeleteMatch[1]!);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '티켓을 찾을 수 없습니다' }, req);
      return;
    }

    // GET /api/evaluations — the evaluation dataset (read-only). Loopback-only:
    // it echoes ticket content (goals/results), matching the /api/tickets guard.
    if (tickets?.listEvaluations && req.method === 'GET' && url.pathname === '/api/evaluations') {
      if (!sensitiveAllowed) {
        sendJson(res, 403, { error: 'Evaluation API is restricted to loopback' }, req);
        return;
      }
      sendJson(res, 200, { evaluations: tickets.listEvaluations() }, req);
      return;
    }

    // Orchestration backends (loopback-only): list + live connectivity check.
    if (backends && req.method === 'GET' && url.pathname === '/api/backends') {
      if (!sensitiveAllowed) {
        sendJson(res, 403, { error: 'Backends API is restricted to loopback' }, req);
        return;
      }
      sendJson(res, 200, { backends: backends.list() }, req);
      return;
    }
    // ── Local git branches ───────────────────────────────────────────────────
    // These check out and delete branches in the user's working tree, so they
    // are loopback-only exactly like the ticket routes. Every branch name is
    // validated in gitBranches before it reaches git.
    if (git && url.pathname.startsWith('/api/git/')) {
      if (!sensitiveAllowed) {
        sendJson(res, 403, { error: 'Git API is restricted to loopback' }, req);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/git/branches') {
        const cwd = url.searchParams.get('cwd');
        if (!cwd || !isAbsolute(cwd)) {
          sendJson(res, 400, { error: 'cwd must be an absolute path' }, req);
          return;
        }
        sendJson(res, 200, { branches: await git.list(cwd) }, req);
        return;
      }
      if (req.method === 'POST' || req.method === 'DELETE') {
        const parsed = GitBranchBodySchema.safeParse(
          JSON.parse(await readBody(req, res).catch(() => '{}') || '{}'),
        );
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: cwd and name are required' }, req);
          return;
        }
        const { cwd, name, from } = parsed.data;
        if (url.pathname === '/api/git/checkout' && req.method === 'POST') {
          sendJson(res, 200, { result: await git.switch(cwd, name) }, req);
          return;
        }
        if (url.pathname === '/api/git/branches' && req.method === 'POST') {
          sendJson(res, 200, { result: await git.create(cwd, name, from) }, req);
          return;
        }
        if (url.pathname === '/api/git/branches' && req.method === 'DELETE') {
          sendJson(res, 200, { result: await git.remove(cwd, name) }, req);
          return;
        }
      }
    }

    // POST /api/ssh/browse — list remote sub-directories for the remote folder
    // picker (loopback-only; the ssh target comes from the local user's preset).
    if (sshBrowse && req.method === 'POST' && url.pathname === '/api/ssh/browse') {
      if (!sensitiveAllowed) {
        sendJson(res, 403, { error: 'SSH browse is restricted to loopback' }, req);
        return;
      }
      try {
        const parsed = z
          .object({ ssh: SshTargetSchema, path: z.string().max(4096).optional() })
          .safeParse(JSON.parse(await readBody(req, res)));
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
      if (!sensitiveAllowed) {
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

    // GET /api/usage — ccusage-style LLM usage records from raw transcripts,
    // for the Tools > Data dashboard. Loopback-only: it reads the local user's
    // Claude Code transcripts (prompt/response metadata lives alongside).
    if (getUsageRecords && req.method === 'GET' && url.pathname === '/api/usage') {
      if (!sensitiveAllowed) {
        sendJson(res, 403, { error: 'Usage API is restricted to loopback' }, req);
        return;
      }
      try {
        const records = await getUsageRecords();
        sendJson(res, 200, { records }, req);
      } catch {
        sendJson(res, 500, { error: 'Failed to read usage transcripts' }, req);
      }
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
        const body = await readBody(req, res);
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

    // GET /api/efficio/profiles?last=60 or ?session_id=... — full dashboard or exact historical session.
    if (req.method === 'GET' && url.pathname === '/api/efficio/profiles') {
      const last = parseInt(url.searchParams.get('last') ?? '60', 10);
      const sessionId = url.searchParams.get('session_id');
      const profiles = efficio
        ? sessionId === null
          ? efficio.profiles(last)
          : efficio.profile(sessionId)
        : { modelVersion: null, sessions: [] };
      sendJson(res, 200, profiles, req);
      return;
    }

    // ── Remote app surface ──────────────────────────────────────────────────
    // The narrow, allowlist-shaped replacement for /api/fs/browse: it answers
    // "which directories may a ticket run in", never "what is on this disk".
    if (req.method === 'GET' && url.pathname === '/api/remote/projects') {
      if (!remoteProjects) {
        sendJson(res, 503, { error: 'Remote project listing is not configured' }, req);
        return;
      }
      sendJson(res, 200, { projects: await remoteProjects() }, req);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/remote/capabilities') {
      sendJson(res, 200, { terminal: accessPolicy.terminalLevel, remote: accessPolicy.enabled }, req);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/remote/branches') {
      const cwd = url.searchParams.get('cwd') ?? '';
      if (!remoteBranches) {
        sendJson(res, 503, { error: 'Remote branch listing is not configured' }, req);
        return;
      }
      if (!cwd) {
        sendJson(res, 400, { error: 'cwd is required' }, req);
        return;
      }
      try {
        sendJson(res, 200, await remoteBranches(cwd), req);
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'branch listing failed' }, req);
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
