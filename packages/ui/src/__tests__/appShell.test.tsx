import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shell mounts the sidebar unconditionally; stub the network so the test
// exercises layout, not fetching.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ repositories: [], worktrees: [], runs: [] }),
  })));
  class FakeSocket {
    readyState = 0;
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('renders the repository sidebar', async () => {
    const { default: App } = await import('../App.tsx');
    render(<App />);
    expect(await screen.findByRole('navigation', { name: /repositor|레포/i })).toBeInTheDocument();
  });
});
