import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readStoredToken,
  storeToken,
  adoptUrlToken,
  wsProtocols,
  installAuthFetch,
  onAuthFailure,
  TOKEN_STORAGE_KEY,
  type TokenStorage,
} from '../lib/auth.ts';

/** jsdom's localStorage is incomplete here, so tests inject their own. */
function memoryStorage(seed: Record<string, string> = {}): TokenStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('token storage', () => {
  it('reads a stored token', () => {
    expect(readStoredToken(memoryStorage({ [TOKEN_STORAGE_KEY]: 'abc' }))).toBe('abc');
  });
  it('returns null when nothing is stored', () => {
    expect(readStoredToken(memoryStorage())).toBeNull();
  });
  it('clears the token when given null', () => {
    const s = memoryStorage({ [TOKEN_STORAGE_KEY]: 'abc' });
    storeToken(null, s);
    expect(readStoredToken(s)).toBeNull();
  });
  it('survives storage that throws — a private window must not break the app', () => {
    const hostile: TokenStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(readStoredToken(hostile)).toBeNull();
    expect(() => storeToken('x', hostile)).not.toThrow();
  });
});

describe('adoptUrlToken', () => {
  it('stores the token from the URL and strips it from the address bar', () => {
    const storage = memoryStorage();
    const replaceState = vi.fn();
    const token = adoptUrlToken(
      { search: '?token=abc123&view=board', pathname: '/', hash: '' },
      { replaceState } as unknown as History,
      storage,
    );
    expect(token).toBe('abc123');
    expect(readStoredToken(storage)).toBe('abc123');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?view=board');
  });

  it('leaves an existing token alone when the URL has none', () => {
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: 'kept' });
    adoptUrlToken({ search: '', pathname: '/', hash: '' }, { replaceState: vi.fn() } as unknown as History, storage);
    expect(readStoredToken(storage)).toBe('kept');
  });
});

describe('wsProtocols', () => {
  it('carries the token as a subprotocol — a browser cannot set a header on a socket', () => {
    expect(wsProtocols('abc')).toEqual(['claude-alive.token.abc']);
  });
  it('offers nothing without a token', () => {
    expect(wsProtocols(null)).toBeUndefined();
  });
});

describe('installAuthFetch', () => {
  let inner: ReturnType<typeof vi.fn>;
  let host: { fetch: typeof fetch };

  beforeEach(() => {
    inner = vi.fn(async () => new Response('{}', { status: 200 }));
    host = { fetch: inner as unknown as typeof fetch };
  });

  it('adds the bearer header to same-origin requests', async () => {
    installAuthFetch(host, () => 'tok');
    await host.fetch('http://localhost:3000/api/tickets');
    const init = inner.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('sends nothing when no token is stored', async () => {
    installAuthFetch(host, () => null);
    await host.fetch('/api/tickets');
    const init = inner.mock.calls[0]![1] as RequestInit | undefined;
    expect(init?.headers ? new Headers(init.headers).get('Authorization') : null).toBeNull();
  });

  it('never attaches the token to a cross-origin request', async () => {
    installAuthFetch(host, () => 'tok');
    await host.fetch('https://api.example.com/v1/thing');
    const init = inner.mock.calls[0]![1] as RequestInit | undefined;
    expect(init?.headers ? new Headers(init.headers).get('Authorization') : null).toBeNull();
  });

  it('does not overwrite an Authorization header the caller set', async () => {
    installAuthFetch(host, () => 'tok');
    await host.fetch('/api/tickets', { headers: { Authorization: 'Bearer explicit' } });
    const init = inner.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer explicit');
  });

  it('reports a 401 so the app can ask for a token', async () => {
    inner.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const seen = vi.fn();
    const off = onAuthFailure(seen);
    installAuthFetch(host, () => 'tok');
    await host.fetch('/api/tickets');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('beginAuthReload', () => {
  it('marks the reload as intentional so the leave-site guard stays quiet', async () => {
    const { beginAuthReload, isAuthReloading } = await import('../lib/auth.ts');
    expect(isAuthReloading()).toBe(false);
    beginAuthReload();
    expect(isAuthReloading()).toBe(true);
  });
});
