import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MobileSessions } from '../MobileSessions.tsx';

afterEach(cleanup);

// jsdom has no canvas for xterm's renderer.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    open() {}
    write() {}
    reset() {}
    resize() {}
    dispose() {}
  },
}));

const noopSub = () => () => {};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/terminals')) {
      return new Response(JSON.stringify({
        terminals: [{ tabId: 'tab-1', cwd: '/w/app', displayName: '열어둔 셸', live: true, lastActivityAt: 5 }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ locations: [] }), { status: 200 });
  }));
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
});

describe('MobileSessions — reopening lands where the phone was', () => {
  it('re-attaches the terminal that was open before the reload', async () => {
    const first = render(
      <MobileSessions subscribeRaw={noopSub} send={() => {}} terminalLevel="input" projects={[]} connected />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /열어둔 셸/ }));
    first.unmount();

    const send = vi.fn();
    render(<MobileSessions subscribeRaw={noopSub} send={send} terminalLevel="input" projects={[]} connected />);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'terminal:attach', tabId: 'tab-1' }));
  });

  it('stays on the list after the terminal was closed', async () => {
    const first = render(
      <MobileSessions subscribeRaw={noopSub} send={() => {}} terminalLevel="input" projects={[]} connected />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /열어둔 셸/ }));
    fireEvent.click(await screen.findByRole('button', { name: /뒤로|Back/ }));
    first.unmount();

    const send = vi.fn();
    render(<MobileSessions subscribeRaw={noopSub} send={send} terminalLevel="input" projects={[]} connected />);
    await screen.findByRole('button', { name: /열어둔 셸/ });
    expect(send).not.toHaveBeenCalled();
  });

  it('waits a poll for a terminal spawned just before the reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      localStorage.setItem('claude-alive.mobile.view.openSession', '"tab-1"');
      let polls = 0;
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (String(url).includes('/api/terminals')) {
          polls += 1;
          const terminals = polls > 1
            ? [{ tabId: 'tab-1', cwd: '/w/app', displayName: '막 띄운 셸', live: true, lastActivityAt: 5 }]
            : [];
          return new Response(JSON.stringify({ terminals }), { status: 200 });
        }
        return new Response(JSON.stringify({ locations: [] }), { status: 200 });
      }));
      const send = vi.fn();
      render(<MobileSessions subscribeRaw={noopSub} send={send} terminalLevel="input" projects={[]} connected />);
      await waitFor(() => expect(polls).toBe(1));
      await vi.advanceTimersByTimeAsync(4000);
      await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'terminal:attach', tabId: 'tab-1' }));
    } finally {
      vi.useRealTimers();
    }
  });
});
