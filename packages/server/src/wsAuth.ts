/**
 * WebSocket upgrade policy.
 *
 * The socket is the most valuable thing this server exposes: it streams every
 * session on connect and accepts `terminal:spawn`, which starts a shell. Before
 * remote mode it was guarded by an Origin check alone — and a missing Origin
 * was allowed, because native clients send none. That is the right call for a
 * loopback-bound server and exactly wrong for one reachable from the network:
 * "send no Origin" is not a barrier, it is the default for anything that is not
 * a browser.
 *
 * So with remote mode on the upgrade needs the same token every HTTP route
 * needs, and the resulting connection is tagged: a device connection is a
 * reader, and terminal messages from it are refused (see index.ts).
 */
import {
  authorizeRequest,
  WS_TOKEN_PROTOCOL_PREFIX,
  type AuthLimiter,
  type RemoteAccessConfig,
} from './remoteAccess.js';
import { isAllowedWsOrigin } from './wsOrigin.js';
import { remoteWsMessageAllowed, type RemoteTerminalLevel } from './remoteTerminal.js';
import type { IncomingHttpHeaders } from 'node:http';

export interface UpgradeInput {
  headers: IncomingHttpHeaders;
  remoteAddress: string | undefined;
  port: number;
}

export type UpgradeDecision =
  | { ok: true; remote: boolean; protocol?: string }
  | { ok: false; reason: 'origin' | 'unauthenticated' | 'forbidden' };

/**
 * Whether an authenticated remote client's Origin is acceptable.
 *
 * A native app sends none — allowed, it has already proved itself with a token. A browser
 * sends one, and the only page that may drive this socket is the dashboard this
 * server served, so the Origin has to be the host the request arrived on.
 */
function remoteOriginAllowed(origin: string | undefined, host: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  if (isAllowedWsOrigin(origin, port)) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function authorizeUpgrade(
  input: UpgradeInput,
  config: RemoteAccessConfig,
  limiter?: AuthLimiter,
): UpgradeDecision {
  const auth = authorizeRequest(
    { method: 'GET', pathname: '/ws', headers: input.headers, remoteAddress: input.remoteAddress },
    config,
    limiter,
  );

  if (auth.kind === 'reject') {
    return { ok: false, reason: auth.status === 403 ? 'forbidden' : 'unauthenticated' };
  }

  // Loopback binding keeps the network out, not the browser: without this any
  // page the user visits could open this socket and read every session.
  if (auth.kind === 'local' || auth.kind === 'untrusted') {
    if (!isAllowedWsOrigin(input.headers.origin, input.port)) return { ok: false, reason: 'origin' };
    return { ok: true, remote: false };
  }

  // `/ws` is never part of the public shell, so anything but a token here is a
  // refusal — stated rather than assumed, because the socket is the one surface
  // where a wrong assumption hands out a shell.
  if (auth.kind !== 'token') return { ok: false, reason: 'unauthenticated' };

  if (!remoteOriginAllowed(input.headers.origin, input.headers.host, input.port)) {
    return { ok: false, reason: 'origin' };
  }
  const offered = input.headers['sec-websocket-protocol'];
  const protocol =
    typeof offered === 'string'
      ? offered.split(',').map((p) => p.trim()).find((p) => p.startsWith(WS_TOKEN_PROTOCOL_PREFIX))
      : undefined;
  return {
    ok: true,
    remote: !auth.fullAccess,
    ...(protocol ? { protocol } : {}),
  };
}

/**
 * Subprotocol negotiation. A browser that offers a subprotocol closes the
 * connection unless the server names one back, so the token protocol has to be
 * echoed verbatim — dropping it looks like a working handshake followed by an
 * immediate disconnect, which is a miserable thing to debug.
 */
export function selectWsProtocol(offered: Set<string>): string | false {
  for (const protocol of offered) {
    if (protocol.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) return protocol;
  }
  return false;
}

/**
 * What a device connection may send, given the configured terminal level.
 * `off` leaves the socket read-only, which is the default; the other levels are
 * documented in remoteTerminal.ts.
 */
export function isRemoteWsMessageAllowed(type: string, level: RemoteTerminalLevel = 'off'): boolean {
  return remoteWsMessageAllowed(type, level);
}
