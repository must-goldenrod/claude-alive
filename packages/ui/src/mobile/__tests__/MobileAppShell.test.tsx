import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MobileApp } from '../MobileApp.tsx';

afterEach(cleanup);

/** Capabilities decide whether the sessions tab exists; everything else is empty. */
function stubFetch(terminal: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/remote/capabilities')) {
      return new Response(JSON.stringify({ terminal, remote: true }), { status: 200 });
    }
    if (String(url).includes('/api/remote/projects')) {
      return new Response(JSON.stringify({ projects: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ tickets: [], items: [], locations: [] }), { status: 200 });
  }));
}

const noopSub = () => () => {};

beforeEach(() => stubFetch('shell'));

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
    fireEvent.click(screen.getByRole('button', { name: /홈|Home/ }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /티켓|Tickets/ })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('hides the sessions tab when the server never opened that surface', async () => {
    stubFetch('off');
    render(<MobileApp subscribeRaw={noopSub} connected send={() => {}} />);
    await screen.findByRole('button', { name: /홈|Home/ });
    expect(screen.queryByRole('tab', { name: /세션|Sessions/ })).not.toBeInTheDocument();
  });
});
