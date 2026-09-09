/**
 * How much of the terminal a remote device may reach.
 *
 * These are three genuinely different powers, so they are three settings rather
 * than one on/off:
 *
 * - `watch` — read the session list and its conversation, and subscribe to a
 *   running pty's output. A stolen token leaks code and prompts; it cannot run
 *   anything.
 * - `input` — type into a pty that is already open. Whatever is on the other
 *   end (a shell, or Claude) takes the keystrokes, so this is execution.
 * - `shell` — start and kill ptys. The token is now equivalent to a shell on
 *   this machine.
 *
 * Default is `off`, and an unrecognised value reads as `off`: the failure
 * direction for a typo in a config file has to be "less access", not more.
 */
export const REMOTE_TERMINAL_LEVELS = ['off', 'watch', 'input', 'shell'] as const;
export type RemoteTerminalLevel = (typeof REMOTE_TERMINAL_LEVELS)[number];

export function parseRemoteTerminalLevel(value: string | undefined): RemoteTerminalLevel {
  const normalised = value?.trim().toLowerCase();
  return (REMOTE_TERMINAL_LEVELS as readonly string[]).includes(normalised ?? '')
    ? (normalised as RemoteTerminalLevel)
    : 'off';
}

function rank(level: RemoteTerminalLevel): number {
  return REMOTE_TERMINAL_LEVELS.indexOf(level);
}

/** The lowest level at which each message is accepted from a device. */
const MESSAGE_LEVEL: Record<string, RemoteTerminalLevel> = {
  ping: 'off',
  'request:snapshot': 'off',
  'terminal:attach': 'watch',
  'terminal:input': 'input',
  'terminal:resize': 'input',
  'terminal:spawn': 'shell',
  'terminal:close': 'shell',
};

export function remoteWsMessageAllowed(type: string, level: RemoteTerminalLevel): boolean {
  const required = MESSAGE_LEVEL[type];
  if (required === undefined) return false;
  return rank(level) >= rank(required);
}

export interface RouteRule {
  method: string;
  pattern: RegExp;
}

/**
 * Read-only session routes, opened from `watch` upward. Deliberately GET-only
 * and deliberately not `/api/prompts`: the conversation endpoint already shows
 * what a session said, without also handing over the prompt-quality store.
 */
const WATCH_ROUTES: readonly RouteRule[] = [
  { method: 'GET', pattern: /^\/api\/v2\/workspace-tree$/ },
  { method: 'GET', pattern: /^\/api\/v2\/sessions\/[^/]+\/conversation$/ },
  { method: 'GET', pattern: /^\/api\/v2\/sessions\/[^/]+\/terminal$/ },
  { method: 'GET', pattern: /^\/api\/claude\/sessions$/ },
];

export function remoteWatchRoutes(level: RemoteTerminalLevel): readonly RouteRule[] {
  return rank(level) >= rank('watch') ? WATCH_ROUTES : [];
}
