import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MobileApp } from '../MobileApp.tsx';

afterEach(cleanup);

/** Capabilities decide whether the sessions tab exists; everything else is empty. */
function stubFetch(terminal: string, tickets: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/remote/capabilities')) {
      return new Response(JSON.stringify({ terminal, remote: true }), { status: 200 });
    }
    if (String(url).includes('/api/remote/projects')) {
      return new Response(JSON.stringify({ projects: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ tickets, items: [], locations: [] }), { status: 200 });
  }));
}

const noopSub = () => () => {};

beforeEach(() => {
  stubFetch('shell');
  // Where the phone was is persisted; each test starts from a clean device.
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
});

describe('MobileApp shell', () => {
  it('puts the brand on the left and the switch on the right', async () => {
    render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    const home = await screen.findByRole('button', { name: /홈|Home/ });
    const tab = await screen.findByRole('tab', { name: /티켓|Tickets/ });
    expect(home.getBoundingClientRect().x).toBeLessThanOrEqual(tab.getBoundingClientRect().x);
  });

  it('returns to the ticket list when the brand is tapped', async () => {
    render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    const sessions = await screen.findByRole('tab', { name: /세션|Sessions/ });
    fireEvent.click(sessions);
    await waitFor(() => expect(sessions).toHaveAttribute('aria-selected', 'true'));
    localStorage.setItem('claude-alive.mobile.view.openSession', '"tab-1"');
    fireEvent.click(screen.getByRole('button', { name: /홈|Home/ }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /티켓|Tickets/ })).toHaveAttribute('aria-selected', 'true'),
    );
    // Home is an exit, so the terminal is not reopened next time.
    expect(localStorage.getItem('claude-alive.mobile.view.openSession')).toBeNull();
  });

  it('hides the sessions tab when the server never opened that surface', async () => {
    stubFetch('off');
    render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    await screen.findByRole('button', { name: /홈|Home/ });
    expect(screen.queryByRole('tab', { name: /세션|Sessions/ })).not.toBeInTheDocument();
  });
});

describe('MobileApp — reopening lands where the phone was', () => {
  it('comes back on the tab it was left on', async () => {
    const first = render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: /세션|Sessions/ }));
    first.unmount();
    render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /세션|Sessions/ })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('reopens the ticket it was reading once the list has loaded', async () => {
    stubFetch('shell', [{ id: 't9', seq: 9, goal: '읽던 티켓', cwd: '/w/app', state: 'running', createdAt: 1 }]);
    const first = render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /읽던 티켓/ }));
    await screen.findByRole('button', { name: /뒤로|Back/ });
    first.unmount();
    render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    // The detail screen has no tab bar; its presence is the back button.
    expect(await screen.findByRole('button', { name: /뒤로|Back/ })).toBeInTheDocument();
  });
});
