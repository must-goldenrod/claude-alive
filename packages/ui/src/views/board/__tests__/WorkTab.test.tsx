import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketEvaluation } from '@claude-alive/core';
import { TicketList } from '../TicketList';
import { WorkTab } from '../WorkTab';

const ticketApi = vi.hoisted(() => ({
  fetchRecords: vi.fn(),
  fetchGuide: vi.fn(),
  setLabel: vi.fn(),
  setReflected: vi.fn(),
}));

vi.mock('../../ticketmgmt/api.ts', () => ({
  ...ticketApi,
}));

const rec = (overrides: Partial<TicketEvaluation>): TicketEvaluation => ({
  ticketId: 't1',
  seq: 1,
  route: '/proj/a',
  goal: 'goal',
  label: 'good',
  autoLabel: 'good',
  humanLabeled: false,
  reflected: false,
  weight: 3,
  updatedAt: 100,
  createdAt: 100,
  ...overrides,
} as TicketEvaluation);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  ticketApi.fetchRecords.mockReset();
  ticketApi.fetchGuide.mockReset();
  ticketApi.setLabel.mockReset();
  ticketApi.setReflected.mockReset();
  ticketApi.fetchGuide.mockResolvedValue({
    route: '/proj/a',
    text: '',
    goodCount: 0,
    badCount: 0,
    updatedAt: 1,
  });
});

describe('TicketList', () => {
  it('groups by route and fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <TicketList
        records={[rec({ ticketId: 't1', headline: 'Hello' })]}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText('Hello'));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('shows loading when records null', () => {
    render(<TicketList records={null} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/loading|불러오는/i)).toBeInTheDocument();
  });

  it('searches goal, headline, and route fields', () => {
    render(
      <TicketList
        records={[
          rec({ ticketId: 'goal', route: '/proj/alpha', goal: 'Authentication flow', headline: 'Goal match' }),
          rec({ ticketId: 'headline', route: '/proj/beta', goal: 'Other goal', headline: 'Database card' }),
          rec({ ticketId: 'route', route: '/proj/needle-route', goal: 'Another goal', headline: 'Route match' }),
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    const search = screen.getByRole('textbox');
    fireEvent.change(search, { target: { value: 'authentication' } });
    expect(screen.getByText('Goal match')).toBeInTheDocument();
    expect(screen.queryByText('Database card')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'database' } });
    expect(screen.getByText('Database card')).toBeInTheDocument();
    expect(screen.queryByText('Goal match')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'needle-route' } });
    expect(screen.getByText('Route match')).toBeInTheDocument();
    expect(screen.queryByText('Database card')).not.toBeInTheDocument();
  });

  it('renders route groups, counts, reflected badge, selection, and label semantics', () => {
    render(
      <TicketList
        records={[
          rec({ ticketId: 'good', route: '/proj/alpha', headline: 'Good ticket', label: 'good', reflected: true, updatedAt: 300 }),
          rec({ ticketId: 'bad', route: '/proj/alpha', headline: 'Bad ticket', label: 'bad', updatedAt: 200 }),
          rec({ ticketId: 'unrated', route: '/proj/beta', headline: 'Unrated ticket', label: 'unrated', updatedAt: 100 }),
        ]}
        selectedId="good"
        onSelect={() => {}}
      />,
    );

    const alpha = screen.getByRole('button', { name: /alpha/i });
    const beta = screen.getByRole('button', { name: /beta/i });
    expect(alpha).toBeInTheDocument();
    expect(beta).toBeInTheDocument();
    expect(within(alpha).getByText(/2\s+(total|전체)/i)).toBeInTheDocument();
    expect(within(alpha).getByText(/1\s+good/i)).toBeInTheDocument();
    expect(within(alpha).getByText(/1\s+bad/i)).toBeInTheDocument();
    expect(within(alpha).getByText(/1\s+(reflected|반영됨)/i)).toBeInTheDocument();

    const goodTicket = screen.getByRole('button', { name: /good ticket/i });
    const badTicket = screen.getByRole('button', { name: /bad ticket/i });
    const unratedTicket = screen.getByRole('button', { name: /unrated ticket/i });
    expect(within(goodTicket).getByText(/reflected|반영됨/i)).toBeInTheDocument();
    expect(goodTicket).toHaveAttribute('aria-pressed', 'true');
    expect(badTicket).toHaveAttribute('aria-pressed', 'false');
    expect(unratedTicket).toHaveAttribute('aria-pressed', 'false');
    const goodLabel = within(goodTicket).getByRole('img', { name: /good/i });
    const badLabel = within(badTicket).getByRole('img', { name: /bad/i });
    const unratedLabel = within(unratedTicket).getByRole('img', { name: /unrated|미평가/i });

    // jsdom drops unresolved CSS variables from computed border shorthands.
    // These are inline token styles, so inspect their inline declaration.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (element) => (element as HTMLElement).style,
    );
    expect(goodLabel).toHaveStyle({ background: 'var(--accent-teal)' });
    expect(badLabel).toHaveStyle({ background: 'var(--accent-red)' });
    expect(unratedLabel).toHaveStyle({ background: 'var(--text-secondary)' });
    expect(goodTicket).toHaveStyle({
      background: 'rgba(88, 166, 255, 0.10)',
      borderLeft: '2px solid var(--accent-blue)',
    });
    expect(badTicket).toHaveStyle({
      background: 'transparent',
      borderLeft: '2px solid transparent',
    });
  });

  it('exposes route collapse state and toggles its tickets', () => {
    render(
      <TicketList
        records={[rec({ route: '/proj/alpha', headline: 'Collapsible ticket' })]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    const group = screen.getByRole('button', { name: /alpha/i });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Collapsible ticket')).not.toBeInTheDocument();
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Collapsible ticket')).toBeInTheDocument();
  });
});

describe('WorkTab', () => {
  it('shows the no-session empty state in quality, efficiency, and process', async () => {
    ticketApi.fetchRecords.mockResolvedValue([
      rec({ ticketId: 'without-session', headline: 'Sessionless ticket' }),
    ]);

    render(<WorkTab active />);
    fireEvent.click(await screen.findByText('Sessionless ticket'));

    for (const name of [/quality|품질/i, /efficiency|효율/i, /process|과정/i]) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByText(/no linked session|연결된 세션 없음/i)).toBeInTheDocument();
    }
  });

  it('propagates the selected ticket and linked session to the detail tabs', async () => {
    ticketApi.fetchRecords.mockResolvedValue([
      rec({
        ticketId: 'linked',
        headline: 'Linked ticket',
        goal: 'Linked outcome',
        claudeSessionId: 'session-123',
      }),
    ]);

    render(<WorkTab active />);
    fireEvent.click(await screen.findByText('Linked ticket'));
    expect(screen.getByText('Linked outcome')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /quality|품질/i }));
    expect(screen.getByText(/no data|데이터 없음/i)).toBeInTheDocument();
    expect(screen.queryByText(/no linked session|연결된 세션 없음/i)).not.toBeInTheDocument();
  });

  it('ports label and reflection updates through the outcome panel', async () => {
    const initial = rec({ ticketId: 'actions', headline: 'Action ticket' });
    ticketApi.fetchRecords.mockResolvedValue([initial]);
    ticketApi.setLabel.mockResolvedValue({
      ...initial,
      label: 'bad',
      humanLabeled: true,
    });
    ticketApi.setReflected.mockResolvedValue({
      ...initial,
      label: 'bad',
      humanLabeled: true,
      reflected: true,
    });

    render(<WorkTab active />);
    fireEvent.click(await screen.findByText('Action ticket'));
    fireEvent.click(screen.getByRole('button', { name: /^bad|나쁨$/i }));
    await waitFor(() => {
      expect(ticketApi.setLabel).toHaveBeenCalledWith('actions', {
        label: 'bad',
        weight: 3,
        note: '',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /reflect into bias|편향에 반영/i }));
    await waitFor(() => {
      expect(ticketApi.setReflected).toHaveBeenCalledWith('actions', true);
    });
  });

  it('fetches only while active and clears its refresh timer on cleanup', async () => {
    ticketApi.fetchRecords.mockResolvedValue([]);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const view = render(<WorkTab active={false} />);
    expect(ticketApi.fetchRecords).not.toHaveBeenCalled();

    view.rerender(<WorkTab active />);
    await waitFor(() => expect(ticketApi.fetchRecords).toHaveBeenCalledTimes(1));
    const cleanupCountBeforeUnmount = clearIntervalSpy.mock.calls.length;
    view.unmount();
    expect(clearIntervalSpy.mock.calls).toHaveLength(cleanupCountBeforeUnmount + 1);
  });

  it('shows the translated unreachable state when loading fails', async () => {
    ticketApi.fetchRecords.mockRejectedValue(new Error('offline'));
    render(<WorkTab active />);
    expect(
      await screen.findByText(
        /could not reach the server to load ticket records|티켓 기록을 불러오기 위해 서버에 연결하지 못했습니다/i,
      ),
    ).toBeInTheDocument();
  });
});
