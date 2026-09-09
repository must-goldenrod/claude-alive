/**
 * Remote access policy: who may reach this server from off-box, and what they
 * may reach.
 *
 * The server used to treat "the request arrived on loopback" as authentication.
 * That is only true without a proxy in front: `ssh -L`, `cloudflared`, or any
 * reverse proxy terminates locally, so a remote caller's `remoteAddress` is
 * `127.0.0.1` and every loopback-gated route opens up. Measured, not assumed —
 * see docs/security/remote-trigger-hardening.md §2.5.
 *
 * So once remote mode is on, the source address stops being evidence: a bearer
 * token is required no matter where the connection appears to come from, and
 * only an explicit allowlist of routes answers a remote caller at all. Keeping
 * loopback trusted while remote mode is on is possible, but it has to be asked
 * for by name (`CLAUDE_ALIVE_TRUST_LOOPBACK=1`).
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import {
  parseRemoteTerminalLevel,
  remoteWatchRoutes,
  type RemoteTerminalLevel,
} from './remoteTerminal.js';

/**
 * Shortest token accepted in remote mode. A remote-reachable ticket API is
 * RCE-equivalent, so a memorable passphrase is not an option; 24 chars is the
 * floor for the 32-byte base64url token `claude-alive token` generates.
 */
export const MIN_TOKEN_CHARS = 24;

/** WebSocket clients cannot set headers, so the token rides the subprotocol. */
export const WS_TOKEN_PROTOCOL_PREFIX = 'claude-alive.token.';

export interface RemoteToken {
  /** Names one device, so a lost phone can be revoked without rotating the rest. */
  label: string;
  value: string;
}

export interface RemoteAccessConfig {
  /** Remote (off-box) access is allowed at all. */
  enabled: boolean;
  /** Interface the HTTP server binds to. */
  host: string;
  /** Keep treating loopback as authenticated while remote mode is on. */
  trustLoopback: boolean;
  tokens: readonly RemoteToken[];
  /** cwd allowlist a remote ticket must fall inside. */
  ticketRoots: readonly string[];
  /** SSH hosts a remote caller may target; empty = no remote ssh tickets. */
  sshHosts: readonly string[];
  /**
   * Full-access token for processes that live on this machine: the hook script,
   * the CLI, and the dashboard the server itself serves. They need routes no
   * remote device may touch (`POST /api/event` above all), and once loopback
   * stops being evidence they need some other way to say "I am local". The
   * answer is filesystem access: this value sits 0600 in ~/.claude-alive/.env,
   * which a tunnelled attacker cannot read. Absent = no such caller exists.
   */
  localToken?: string;
  /**
   * How far into the terminal a device may reach: none, watch, type, or spawn.
   * See remoteTerminal.ts — each step is a different power, not a bigger one.
   */
  terminalLevel: RemoteTerminalLevel;
}

export type ConfigResult =
  | { ok: true; config: RemoteAccessConfig }
  | { ok: false; errors: string[] };

/**
 * How a request may proceed.
 * - `local`    — trusted loopback caller; the pre-existing per-route gates apply.
 * - `token`    — authenticated remote caller on an allowlisted route.
 * - `untrusted`— not loopback, remote mode off; per-route gates answer 403 as before.
 * - `reject`   — answer now, with this status.
 */
export type AuthOutcome =
  | { kind: 'local' }
  | { kind: 'public' }
  | { kind: 'token'; label: string; fullAccess: boolean }
  | { kind: 'untrusted' }
  | { kind: 'reject'; status: 401 | 403 | 429; error: string };

/** Hostnames/addresses that mean "this machine". */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

const truthy = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

/**
 * Read tokens from `CLAUDE_ALIVE_TOKEN` (one) and `CLAUDE_ALIVE_TOKENS`
 * (`label:value` entries, comma-separated). A bare value gets a positional
 * label so the list form still works for someone who does not care to name
 * their devices.
 */
export function parseTokens(env: NodeJS.ProcessEnv): RemoteToken[] {
  const out: RemoteToken[] = [];
  const single = env.CLAUDE_ALIVE_TOKEN?.trim();
  if (single) out.push({ label: 'default', value: single });
  const list = env.CLAUDE_ALIVE_TOKENS?.trim();
  if (list) {
    let n = 0;
    for (const raw of list.split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      n += 1;
      const sep = entry.indexOf(':');
      // A bare token has no colon; a labelled one is `label:value`.
      if (sep > 0) {
        const label = entry.slice(0, sep).trim();
        const value = entry.slice(sep + 1).trim();
        if (label && value) out.push({ label, value });
      } else {
        out.push({ label: `token${n}`, value: entry });
      }
    }
  }
  return out;
}

/**
 * Constant-time comparison against every configured token. Length is checked
 * first because `timingSafeEqual` throws on a mismatch — that check leaks only
 * the length, which the attacker already controls.
 */
export function verifyToken(provided: string | undefined, tokens: readonly RemoteToken[]): string | null {
  if (!provided) return null;
  const offered = Buffer.from(provided);
  let match: string | null = null;
  for (const token of tokens) {
    const expected = Buffer.from(token.value);
    if (expected.length !== offered.length) continue;
    // No early return: keep comparing so the reply time does not reveal which
    // token matched or how far down the list it sat.
    if (timingSafeEqual(expected, offered) && match === null) match = token.label;
  }
  return match;
}

/** Pull the token out of `Authorization: Bearer …` or the WS subprotocol. */
export function bearerFromHeaders(headers: IncomingHttpHeaders): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1]!.trim();
  }
  // Node folds a repeated Sec-WebSocket-Protocol into one comma-joined string.
  const offered = headers['sec-websocket-protocol'];
  if (typeof offered === 'string') {
    for (const raw of offered.split(',')) {
      const entry = raw.trim();
      if (entry.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) {
        const value = entry.slice(WS_TOKEN_PROTOCOL_PREFIX.length);
        if (value) return value;
      }
    }
  }
  return undefined;
}

/**
 * Routes a remote caller may reach. Deliberately an allowlist keyed on method
 * *and* exact path: the previous shape (a loopback check added per sensitive
 * route) meant every new route was remotely readable until someone remembered
 * to gate it. Here a new route is closed until it is named.
 */
const REMOTE_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/health$/ },
  { method: 'GET', pattern: /^\/api\/status$/ },
  { method: 'GET', pattern: /^\/api\/tickets$/ },
  { method: 'POST', pattern: /^\/api\/tickets$/ },
  { method: 'POST', pattern: /^\/api\/tickets\/[^/]+\/(cancel|retry|reply)$/ },
  { method: 'GET', pattern: /^\/api\/evaluations$/ },
  { method: 'GET', pattern: /^\/api\/remote\/projects$/ },
  { method: 'GET', pattern: /^\/api\/remote\/branches$/ },
  // The live stream. Read-only for a device: `terminal:*` is refused per
  // connection in wsAuth, not here, because the allowlist is path-shaped.
  { method: 'GET', pattern: /^\/ws$/ },
];

export function isRemoteAllowed(
  method: string,
  pathname: string,
  terminalLevel: RemoteTerminalLevel = 'off',
): boolean {
  if (REMOTE_ROUTES.some((r) => r.method === method && r.pattern.test(pathname))) return true;
  return remoteWatchRoutes(terminalLevel).some((r) => r.method === method && r.pattern.test(pathname));
}

export interface AuthLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

export interface AuthLimiter {
  locked: (key: string) => boolean;
  fail: (key: string) => void;
  succeed: (key: string) => void;
}

/**
 * Failure counter per source address. A remote token is the only thing between
 * the network and an autonomous agent, so an unbounded guess rate is not
 * acceptable; this is deliberately in-memory and per-process — a restart
 * clearing it is fine, the point is to make online guessing slow.
 */
export function createAuthLimiter(options: AuthLimiterOptions = {}): AuthLimiter {
  const maxFailures = options.maxFailures ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const failures = new Map<string, { count: number; firstAt: number }>();

  const current = (key: string) => {
    const rec = failures.get(key);
    if (!rec) return undefined;
    if (now() - rec.firstAt > windowMs) {
      failures.delete(key);
      return undefined;
    }
    return rec;
  };

  return {
    locked: (key) => (current(key)?.count ?? 0) >= maxFailures,
    fail: (key) => {
      const rec = current(key);
      if (rec) rec.count += 1;
      else failures.set(key, { count: 1, firstAt: now() });
    },
    succeed: (key) => {
      failures.delete(key);
    },
  };
}

export interface AuthorizeInput {
  method: string;
  pathname: string;
  headers: IncomingHttpHeaders;
  remoteAddress: string | undefined;
  /**
   * `?token=` from the URL. A browser opening the dashboard cannot set a
   * header, so `claude-alive start` hands it the token in the URL once and the
   * page moves it into localStorage. Accepted for the UI shell only — see
   * `acceptsSearchToken`.
   */
  searchToken?: string;
}

/**
 * URLs leak: access logs, shell history, `Referer`. So a token in the query
 * string buys exactly one thing — bootstrapping the served dashboard — and is
 * refused everywhere an API client could have sent a header instead.
 */
function acceptsSearchToken(pathname: string): boolean {
  return !pathname.startsWith('/api/') && !pathname.startsWith('/v1/');
}

/**
 * Paths that make up the dashboard shell: the HTML document and the bundle it
 * pulls in. These are served before authentication because a browser has no way
 * to authenticate them — a navigation and a `<script src>` carry no headers, and
 * only `fetch` can. Gating them did not protect anything (the bundle is this
 * repository, published); it just meant the page could never boot, so the token
 * prompt inside it never appeared either.
 *
 * Everything the shell then requests — the API, the socket, `/health` — still
 * needs a token. That is where the sessions, prompts and ticket controls are.
 */
function isShellPath(method: string, pathname: string): boolean {
  if (method !== 'GET') return false;
  if (pathname === '/health' || pathname === '/ws') return false;
  return !pathname.startsWith('/api/') && !pathname.startsWith('/v1/');
}

/**
 * The single decision point for every HTTP request and WebSocket upgrade.
 *
 * Note what is *not* here: `isLoopbackAddress(...) || hasToken(...)`. That
 * disjunction is exactly the hole a tunnel opens, because the left side is true
 * for tunnelled remote callers. With remote mode on, loopback buys nothing
 * unless `trustLoopback` was set on purpose.
 */
export function authorizeRequest(
  input: AuthorizeInput,
  config: RemoteAccessConfig,
  limiter?: AuthLimiter,
): AuthOutcome {
  const loopback = isLoopbackAddress(input.remoteAddress);

  if (!config.enabled) {
    // Unchanged behaviour: the per-route loopback gates decide.
    return loopback ? { kind: 'local' } : { kind: 'untrusted' };
  }

  if (config.trustLoopback && loopback) return { kind: 'local' };

  const key = input.remoteAddress ?? 'unknown';
  if (limiter?.locked(key)) {
    return { kind: 'reject', status: 429, error: 'Too many failed authentications' };
  }

  const offered =
    bearerFromHeaders(input.headers) ??
    (acceptsSearchToken(input.pathname) ? input.searchToken : undefined);

  // No credential offered, but the request is for the shell: serve it so the
  // page can boot and ask for one.
  if (!offered && isShellPath(input.method, input.pathname)) return { kind: 'public' };

  const known: RemoteToken[] = config.localToken
    ? [{ label: 'local', value: config.localToken }, ...config.tokens]
    : [...config.tokens];
  const label = verifyToken(offered, known);
  if (label === null) {
    limiter?.fail(key);
    // The message names neither the offered token nor whether one was offered.
    return { kind: 'reject', status: 401, error: 'Authentication required' };
  }
  limiter?.succeed(key);

  const fullAccess = label === 'local' && config.localToken !== undefined;
  if (!fullAccess && !isRemoteAllowed(input.method, input.pathname, config.terminalLevel)) {
    return { kind: 'reject', status: 403, error: 'Route is not available to remote callers' };
  }
  return { kind: 'token', label, fullAccess };
}

/**
 * Build the config from the environment, refusing to boot rather than warning.
 * Every failure here is a state where the safe reading and the useful reading
 * differ (bound wide with no token, remote tickets with no cwd allowlist), and
 * a warning in a detached daemon's log file is not read.
 */
export function loadRemoteAccessConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const enabled = truthy(env.CLAUDE_ALIVE_REMOTE);
  const terminalLevel = parseRemoteTerminalLevel(env.CLAUDE_ALIVE_REMOTE_TERMINAL);
  const explicitHost = env.CLAUDE_ALIVE_HOST?.trim();
  const host = explicitHost || (enabled ? '0.0.0.0' : '127.0.0.1');
  const errors: string[] = [];

  const hostIsLoopback = host === 'localhost' || isLoopbackAddress(host);
  if (!enabled && !hostIsLoopback) {
    errors.push(
      `CLAUDE_ALIVE_HOST=${host} exposes the server beyond this machine. Set CLAUDE_ALIVE_REMOTE=1 ` +
        'to opt in (which also requires CLAUDE_ALIVE_TOKEN and CLAUDE_ALIVE_TICKET_ROOTS).',
    );
  }

  const tokens = parseTokens(env);
  const ticketRoots = (env.CLAUDE_ALIVE_TICKET_ROOTS ?? '').split(':').map((s) => s.trim()).filter(Boolean);
  const sshHosts = (env.CLAUDE_ALIVE_REMOTE_SSH_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (enabled) {
    if (tokens.length === 0) {
      errors.push('CLAUDE_ALIVE_REMOTE=1 requires CLAUDE_ALIVE_TOKEN (or CLAUDE_ALIVE_TOKENS). Run: claude-alive token new');
    }
    for (const token of tokens) {
      if (token.value.length < MIN_TOKEN_CHARS) {
        errors.push(`Token "${token.label}" is shorter than ${MIN_TOKEN_CHARS} characters. Run: claude-alive token new`);
      }
    }
    if (ticketRoots.length === 0) {
      errors.push(
        'CLAUDE_ALIVE_REMOTE=1 requires CLAUDE_ALIVE_TICKET_ROOTS — a remote caller can start an autonomous agent, ' +
          'so the directories it may run in have to be named.',
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      enabled,
      host,
      trustLoopback: truthy(env.CLAUDE_ALIVE_TRUST_LOOPBACK),
      tokens,
      ticketRoots,
      sshHosts,
      terminalLevel,
      ...(env.CLAUDE_ALIVE_LOCAL_TOKEN?.trim() ? { localToken: env.CLAUDE_ALIVE_LOCAL_TOKEN.trim() } : {}),
    },
  };
}
