import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPO_SIDEBAR_WIDTH } from '../state/layoutInsets.ts';

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
  // jsdom ships neither of these; without them the lazy views throw and the
  // ErrorBoundary swallows the tree we are trying to measure.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = vi.fn();
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

  it('keeps the to-do dock clear of the sidebar', async () => {
    const { default: App } = await import('../App.tsx');
    const { container } = render(<App />);
    await screen.findByRole('navigation', { name: /repositor|레포/i });

    // The dock is fixed to the viewport, so it has to start past the sidebar
    // rather than at the window's left edge, or it renders on top of it.
    // TicketsView is lazy, so wait for the dock to appear before measuring.
    const findDock = () =>
      [...container.querySelectorAll<HTMLElement>('div')].find(
        (el) => el.style.position === 'fixed' && el.style.width === '300px' && el.style.zIndex === '20',
      );
    await waitFor(() => expect(findDock()).toBeDefined());
    expect(parseInt(findDock()!.style.left, 10)).toBeGreaterThanOrEqual(REPO_SIDEBAR_WIDTH);
  });
});
