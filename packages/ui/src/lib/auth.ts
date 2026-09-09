/**
 * Client-side half of remote access.
 *
 * With remote mode on, the server stops treating a loopback address as
 * authentication, so every call from this page needs a bearer token — including
 * the ones made from the machine running the server. The token reaches the page
 * one of two ways: `claude-alive start` opens the dashboard with `?token=…`
 * once, or the user pastes a device token into the prompt.
 *
 * The header is attached by wrapping `fetch` rather than by editing all
 * forty-odd call sites. That keeps this cross-cutting concern in one file and,
 * more importantly, makes it impossible for a new call site to forget it — the
 * failure mode of the alternative is a route that works locally and 401s only
 * once someone turns remote mode on.
 */

export const TOKEN_STORAGE_KEY = 'claude-alive.token';
const WS_TOKEN_PROTOCOL_PREFIX = 'claude-alive.token.';

export interface TokenStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** A private window (or a browser blocking site data) throws on access. */
function browserStorage(): TokenStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredToken(storage: TokenStorage | null = browserStorage()): string | null {
  try {
    return storage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeToken(token: string | null, storage: TokenStorage | null = browserStorage()): void {
  try {
    if (token) storage?.setItem(TOKEN_STORAGE_KEY, token);
    else storage?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage denied: the token still works for this page load, held by the
    // module-level cache in installAuthFetch's reader.
  }
}

/** The subset of `window.location` this module reads. */
export interface LocationLike {
  search: string;
  pathname: string;
  hash: string;
}

/**
 * Take `?token=` out of the URL, persist it, and rewrite the address bar.
 *
 * The strip matters: a URL with a live credential in it gets bookmarked,
 * screenshotted and pasted into chat.
 */
export function adoptUrlToken(
  location: LocationLike = window.location,
  history: History = window.history,
  storage: TokenStorage | null = browserStorage(),
): string | null {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (!token) return readStoredToken(storage);
  storeToken(token, storage);
  params.delete('token');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return token;
}

/**
 * A browser cannot set headers on a WebSocket, so the token rides the
 * subprotocol list; the server echoes it back to complete the handshake.
 */
export function wsProtocols(token: string | null = readStoredToken()): string[] | undefined {
  return token ? [`${WS_TOKEN_PROTOCOL_PREFIX}${token}`] : undefined;
}

type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();

/** Notified when the server answers 401 — the app then asks for a token. */
export function onAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

/** Same-origin only: the token is for this server and must not leak elsewhere. */
function isSameOrigin(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/^[a-z]+:\/\//i.test(raw)) return true;
  try {
    return new URL(raw).origin === window.location.origin;
  } catch {
    return false;
  }
}

export interface FetchHost {
  fetch: typeof fetch;
}

export function installAuthFetch(
  host: FetchHost = window as unknown as FetchHost,
  token: () => string | null = () => readStoredToken(),
): void {
  const original = host.fetch.bind(host);
  host.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const value = token();
    let nextInit = init;
    if (value && isSameOrigin(input)) {
      const headers = new Headers(init?.headers);
      // An explicit header wins: a caller that set one meant it.
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${value}`);
      nextInit = { ...init, headers };
    }
    const response = await original(input, nextInit);
    if (response.status === 401) {
      for (const listener of authFailureListeners) listener();
    }
    return response;
  };
}
