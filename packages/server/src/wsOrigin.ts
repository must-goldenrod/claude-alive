/** Hostnames that mean "this machine". */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Whether a WebSocket upgrade may proceed.
 *
 * The socket streams every session's prompts and events. Without this check any
 * page in the user's browser can open `ws://localhost:3141/ws` and read all of
 * it — loopback binding stops the network, not the browser.
 *
 * A missing Origin is allowed: native clients (the CLI, tests, `wscat`) send
 * none, and they already have the same filesystem access the socket exposes.
 */
export function isAllowedWsOrigin(origin: string | undefined, _port: number): boolean {
  if (origin === undefined) return true;
  if (origin.length === 0) return false;
  try {
    // Any loopback port is fine — the Vite dev server runs on its own.
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
