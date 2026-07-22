import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { TicketEvaluation } from '@claude-alive/core';
import { TicketMgmtView } from '../TicketMgmtView.tsx';

// Keys pass through so assertions can target them directly; interpolation is
// rendered as a readable fallback.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

function record(over: Partial<TicketEvaluation> = {}): TicketEvaluation {
  return {
    ticketId: 't1',
    seq: 1,
    route: '/proj/alpha',
    goal: 'add tests',
    headline: 'coverage 92%',
    model: 'claude-opus-4-8',
    verdictPassed: true,
    autoLabel: 'good',
    label: 'good',
    humanLabeled: false,
    reflected: false,
    weight: 3,
    result: '## Result\nall green',
    completedAt: 1000,
    createdAt: 1,
    updatedAt: 5,
    ...over,
  };
}

/** Route fetch by URL + method so the component's several endpoints can coexist. */
function installFetch(records: TicketEvaluation[], onReflect?: (body: unknown) => void) {
  const reflectedNow = { ...records[0]!, reflected: true };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/evaluations')) {
      return { ok: true, status: 200, json: async () => ({ evaluations: records }) } as Response;
    }
    if (url.includes('/api/tickets/guide')) {
      return { ok: true, status: 200, json: async () => ({ guide: { route: '/proj/alpha', text: '', goodCount: 0, badCount: 0, updatedAt: 1 } }) } as Response;
    }
    if (url.includes('/reflect')) {
      onReflect?.(init?.body ? JSON.parse(init.body as string) : undefined);
      return { ok: true, status: 200, json: async () => ({ evaluation: reflectedNow }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TicketMgmtView', () => {
  it('groups tickets by route and dissects a selected ticket', async () => {
    installFetch([record()]);
    render(<TicketMgmtView active />);

    // Route group title = basename of the route.
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
    // Ticket row shows the headline; click it.
    fireEvent.click(screen.getByText('coverage 92%'));

    // Dissection shows the goal and the result snapshot.
    await waitFor(() => expect(screen.getByText('add tests')).toBeTruthy());
    expect(screen.getByText(/all green/)).toBeTruthy();
  });

  it('opting a ticket into the bias posts reflect=true and reflects the new state', async () => {
    let sentBody: unknown;
    installFetch([record()], (b) => { sentBody = b; });
    render(<TicketMgmtView active />);

    await waitFor(() => expect(screen.getByText('coverage 92%')).toBeTruthy());
    fireEvent.click(screen.getByText('coverage 92%'));

    // Not yet reflected → the toggle offers to reflect.
    const toggle = await screen.findByText('ticketMgmt.reflect.off');
    fireEvent.click(toggle);

    // Server was asked to reflect, and the UI now shows the reflected state.
    await waitFor(() => expect(sentBody).toEqual({ reflected: true }));
    await waitFor(() => expect(screen.getByText('✓ ticketMgmt.reflect.on')).toBeTruthy());
  });

  it('shows the unreachable state when the dataset cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    render(<TicketMgmtView active />);
    await waitFor(() => expect(screen.getByText('ticketMgmt.unreachable.title')).toBeTruthy());
  });
});
