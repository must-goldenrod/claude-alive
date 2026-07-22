import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useConversation } from '../hooks/useConversation';

const PAGE = {
  sessionId: 'S1',
  items: [
    { itemId: 'E1', kind: 'user', occurredAt: 1, confidence: 'exact', text: 'fix the bug' },
    { itemId: 'E2', kind: 'tool-call', occurredAt: 2, confidence: 'exact', toolName: 'Bash', status: 'completed' },
    { itemId: 'E3', kind: 'assistant', occurredAt: 3, confidence: 'exact', text: 'done' },
  ],
  cursor: 3,
  hasMore: false,
  completeness: 'hook-derived',
};

function mockFetch(impl: () => Promise<Partial<Response>>) {
  vi.stubGlobal('fetch', vi.fn(() => impl() as Promise<Response>));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useConversation', () => {
  it('fetches nothing when no session is selected', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const { result } = renderHook(() => useConversation(null));
    await vi.advanceTimersByTimeAsync(100);
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('loads the conversation for a session', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => PAGE }));
    const { result } = renderHook(() => useConversation('S1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.completeness).toBe('hook-derived');
  });

  it('distinguishes an unknown session from an empty conversation', async () => {
    mockFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: 'unknown session' }) }));
    const { result } = renderHook(() => useConversation('nope'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('reports the log being unavailable separately from an error', async () => {
    mockFetch(async () => ({ ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }));
    const { result } = renderHook(() => useConversation('S1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports a network failure as an error', async () => {
    mockFetch(async () => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => useConversation('S1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('reloads when the selected session changes', async () => {
    // Typed with the url parameter so the assertion below can read it back.
    const spy = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => PAGE }));
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const { result, rerender } = renderHook(({ id }) => useConversation(id), {
      initialProps: { id: 'S1' as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = spy.mock.calls.length;
    rerender({ id: 'S2' });
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
    expect(String(spy.mock.calls.at(-1)?.[0])).toContain('S2');
  });

  it('clears state when the selection is cleared', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => PAGE }));
    const { result, rerender } = renderHook(({ id }) => useConversation(id), {
      initialProps: { id: 'S1' as string | null },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    rerender({ id: null });
    await waitFor(() => expect(result.current.items).toEqual([]));
  });
});
