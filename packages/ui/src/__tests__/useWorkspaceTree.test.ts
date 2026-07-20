import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorkspaceTree } from '../hooks/useWorkspaceTree';

const TREE = {
  locations: [
    {
      location: { locationId: 'local', kind: 'local', displayName: 'This Mac', status: 'online' },
      workspaces: [
        {
          workspace: { workspaceId: 'W1', locationId: 'local', rootPath: '/repo/a', kind: 'git', displayName: 'alpha' },
          sessions: [
            {
              sessionId: 'S1',
              provider: 'claude',
              title: 'fix the bug',
              titleSource: 'first-prompt',
              state: 'thinking',
              stateConfidence: 'derived',
              pendingApprovals: 0,
              lastActiveAt: 1,
            },
          ],
        },
      ],
    },
  ],
};

function mockFetch(impl: (url: string) => Promise<Partial<Response>>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => impl(url) as Promise<Response>));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useWorkspaceTree', () => {
  it('starts in a loading state with no tree', () => {
    mockFetch(() => new Promise(() => {})); // never settles
    const { result } = renderHook(() => useWorkspaceTree());
    expect(result.current.loading).toBe(true);
    expect(result.current.tree).toBeNull();
  });

  it('exposes the tree once loaded', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => TREE }));
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tree).toEqual(TREE);
    expect(result.current.error).toBeNull();
  });

  it('reports the canonical log being unavailable rather than showing an empty tree', async () => {
    // 503 means "cannot read", which must not look like "no sessions".
    mockFetch(async () => ({ ok: false, status: 503, json: async () => ({ error: 'canonical event log unavailable' }) }));
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.tree).toBeNull();
  });

  it('reports a network failure as an error, not as an empty tree', async () => {
    mockFetch(async () => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.tree).toBeNull();
  });

  it('refetches when refresh is called', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => TREE }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = fetchSpy.mock.calls.length;
    result.current.refresh();
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(before));
  });

  it('does not poll while inactive', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => TREE }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    renderHook(() => useWorkspaceTree({ active: false }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
