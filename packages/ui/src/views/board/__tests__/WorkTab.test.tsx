import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
    expect(screen.getByText(/loading|불러오는 중/i)).toBeInTheDocument();
    expect(await screen.findByText(/no data|데이터 없음/i)).toBeInTheDocument();
    expect(screen.queryByText(/no linked session|연결된 세션 없음/i)).not.toBeInTheDocument();
  });

  it('connects detail tabs to their panel and supports wrapping arrow navigation', async () => {
    ticketApi.fetchRecords.mockResolvedValue([
      rec({ ticketId: 'keyboard', headline: 'Keyboard ticket' }),
    ]);

    render(<WorkTab active />);
    fireEvent.click(await screen.findByText('Keyboard ticket'));
    const outcomeTab = screen.getByRole('tab', { name: /outcome|성과/i });
    const qualityTab = screen.getByRole('tab', { name: /quality|품질/i });
    const efficiencyTab = screen.getByRole('tab', { name: /efficiency|효율/i });
    const processTab = screen.getByRole('tab', { name: /process|과정/i });

    expect(outcomeTab).toHaveAttribute('aria-controls', 'ticket-detail-panel-outcome');
    expect(outcomeTab).toHaveAttribute('tabindex', '0');
    expect(document.getElementById('ticket-detail-panel-outcome')).toHaveAttribute(
      'aria-labelledby',
      'ticket-detail-tab-outcome',
    );
    for (const tab of [outcomeTab, qualityTab, efficiencyTab, processTab]) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).not.toBeNull();
      expect(document.getElementById(panelId!)).toHaveAttribute('role', 'tabpanel');
      expect(document.getElementById(panelId!)).toHaveAttribute('aria-labelledby', tab.id);
    }

    outcomeTab.focus();
    fireEvent.keyDown(outcomeTab, { key: 'ArrowRight' });
    expect(qualityTab).toHaveFocus();
    expect(qualityTab).toHaveAttribute('aria-selected', 'true');
    expect(qualityTab).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(qualityTab, { key: 'ArrowLeft' });
    expect(outcomeTab).toHaveFocus();
    fireEvent.keyDown(outcomeTab, { key: 'ArrowLeft' });
    expect(processTab).toHaveFocus();
    expect(processTab).toHaveAttribute('aria-selected', 'true');
  });

  it('renders authoritative label/reflection updates and refreshes the current guide', async () => {
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
    await waitFor(() => expect(ticketApi.fetchGuide).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /^bad|나쁨$/i }));
    await waitFor(() => {
      expect(ticketApi.setLabel).toHaveBeenCalledWith('actions', {
        label: 'bad',
        weight: 3,
        note: '',
      });
    });
    await waitFor(() => {
      const ticketRow = screen.getByRole('button', { name: /action ticket/i });
      expect(within(ticketRow).getByRole('img', { name: /^bad|나쁨$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /reflect into bias|편향에 반영/i }));
    await waitFor(() => {
      expect(ticketApi.setReflected).toHaveBeenCalledWith('actions', true);
    });
    expect(await screen.findByText(/✓\s*(reflected into bias|편향에 반영됨)/i)).toBeInTheDocument();
    await waitFor(() => expect(ticketApi.fetchGuide).toHaveBeenCalledTimes(2));
  });

  it('does not show saved after a failed label mutation and refreshes server truth', async () => {
    const initial = rec({ ticketId: 'failed-label', headline: 'Failed label ticket' });
    ticketApi.fetchRecords
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([initial]);
    ticketApi.setLabel.mockRejectedValue(new Error('rejected'));

    render(<WorkTab active />);
    fireEvent.click(await screen.findByText('Failed label ticket'));
    fireEvent.click(screen.getByRole('button', { name: /^bad|나쁨$/i }));

    await waitFor(() => expect(ticketApi.fetchRecords).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/^saved$|^저장됨$/i)).not.toBeInTheDocument();
    const ticketRow = screen.getByRole('button', { name: /failed label ticket/i });
    expect(within(ticketRow).getByRole('img', { name: /^good|좋음$/i })).toBeInTheDocument();
  });

  it('remounts ticket-local mutation state and does not refresh B guide for late A reflect', async () => {
    const reflectA = deferred<TicketEvaluation>();
    const ticketA = rec({ ticketId: 'a', route: '/proj/a', headline: 'Ticket A' });
    const ticketB = rec({ ticketId: 'b', route: '/proj/b', headline: 'Ticket B' });
    ticketApi.fetchRecords.mockResolvedValue([ticketA, ticketB]);
    ticketApi.setReflected.mockReturnValue(reflectA.promise);

    render(<WorkTab active />);
    fireEvent.click(await screen.findByText('Ticket A'));
    await waitFor(() => expect(ticketApi.fetchGuide).toHaveBeenCalledWith('/proj/a'));
    fireEvent.click(screen.getByRole('button', { name: /reflect into bias|편향에 반영/i }));

    fireEvent.click(screen.getByText('Ticket B'));
    await waitFor(() => expect(ticketApi.fetchGuide).toHaveBeenCalledWith('/proj/b'));
    const ticketBReflect = screen.getByRole('button', {
      name: /reflect into bias|편향에 반영/i,
    });
    expect(ticketBReflect).toBeEnabled();
    const guideCallsBeforeACompletes = ticketApi.fetchGuide.mock.calls.length;

    await act(async () => {
      reflectA.resolve({ ...ticketA, reflected: true });
      await reflectA.promise;
    });
    expect(ticketApi.fetchGuide).toHaveBeenCalledTimes(guideCallsBeforeACompletes);
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

  it('keeps only the latest refresh result when requests resolve out of order', async () => {
    vi.useFakeTimers();
    const first = deferred<TicketEvaluation[]>();
    const second = deferred<TicketEvaluation[]>();
    ticketApi.fetchRecords
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<WorkTab active />);
    expect(ticketApi.fetchRecords).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(ticketApi.fetchRecords).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve([rec({ ticketId: 'new', headline: 'Newest result' })]);
      await second.promise;
    });
    expect(screen.getByText('Newest result')).toBeInTheDocument();

    await act(async () => {
      first.resolve([rec({ ticketId: 'old', headline: 'Stale result' })]);
      await first.promise;
    });
    expect(screen.getByText('Newest result')).toBeInTheDocument();
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
  });

  it('ignores pending refresh success and failure after becoming inactive', async () => {
    const staleSuccess = deferred<TicketEvaluation[]>();
    const staleFailure = deferred<TicketEvaluation[]>();
    ticketApi.fetchRecords
      .mockReturnValueOnce(staleSuccess.promise)
      .mockReturnValueOnce(staleFailure.promise);
    const view = render(<WorkTab active />);

    view.rerender(<WorkTab active={false} />);
    await act(async () => {
      staleSuccess.resolve([rec({ ticketId: 'stale', headline: 'Inactive result' })]);
      await staleSuccess.promise;
    });
    expect(screen.queryByText('Inactive result')).not.toBeInTheDocument();

    view.rerender(<WorkTab active />);
    expect(ticketApi.fetchRecords).toHaveBeenCalledTimes(2);
    view.rerender(<WorkTab active={false} />);
    await act(async () => {
      staleFailure.reject(new Error('late failure'));
      try {
        await staleFailure.promise;
      } catch {
        // The component should consume the rejected refresh without changing UI.
      }
    });
    expect(
      screen.queryByText(
        /could not reach the server to load ticket records|티켓 기록을 불러오기 위해 서버에 연결하지 못했습니다/i,
      ),
    ).not.toBeInTheDocument();
  });
});
