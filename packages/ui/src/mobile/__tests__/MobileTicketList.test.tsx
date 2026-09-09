import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { MobileTicketList } from '../MobileTicketList.tsx';

afterEach(cleanup);

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: 't1', seq: 1, goal: '로그인 버그를 고쳐줘', cwd: '/Users/me/work/app',
  state: 'running', createdAt: Date.now(), ...over,
} as Ticket);

describe('MobileTicketList', () => {
  it('shows one row per ticket with its goal and project', () => {
    render(
      <MobileTicketList
        tickets={[ticket({}), ticket({ id: 't2', seq: 2, goal: '두 번째', cwd: '/Users/me/work/other' })]}
        evaluations={{}}
        onOpen={() => {}}
        onNew={() => {}}
      />,
    );
    expect(screen.getByText('로그인 버그를 고쳐줘')).toBeInTheDocument();
    expect(screen.getByText('두 번째')).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('puts tickets waiting on a human answer first — they are the ones that block', () => {
    render(
      <MobileTicketList
        tickets={[
          ticket({ id: 'a', goal: '실행중인 것', state: 'running' }),
          ticket({ id: 'b', goal: '답을 기다리는 것', state: 'decision' }),
        ]}
        evaluations={{}}
        onOpen={() => {}}
        onNew={() => {}}
      />,
    );
    const rows = screen.getAllByRole('button', { name: /것/ });
    expect(rows[0]).toHaveTextContent('답을 기다리는 것');
  });

  it('opens a ticket when its row is tapped', () => {
    const onOpen = vi.fn();
    render(<MobileTicketList tickets={[ticket({})]} evaluations={{}} onOpen={onOpen} onNew={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /로그인 버그/ }));
    expect(onOpen).toHaveBeenCalledWith('t1');
  });

  it('filters to the tickets that need an answer', () => {
    render(
      <MobileTicketList
        tickets={[ticket({ id: 'a', goal: '실행중', state: 'running' }), ticket({ id: 'b', goal: '답변대기', state: 'decision' })]}
        evaluations={{}}
        onOpen={() => {}}
        onNew={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /답변|answer/i }));
    expect(screen.getByText('답변대기')).toBeInTheDocument();
    expect(screen.queryByText('실행중')).not.toBeInTheDocument();
  });

  it('offers a new ticket button', () => {
    const onNew = vi.fn();
    render(<MobileTicketList tickets={[]} evaluations={{}} onOpen={() => {}} onNew={onNew} />);
    fireEvent.click(screen.getByRole('button', { name: /새 티켓|New ticket/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it('says so when there is nothing, rather than showing a blank screen', () => {
    render(<MobileTicketList tickets={[]} evaluations={{}} onOpen={() => {}} onNew={() => {}} />);
    expect(screen.getByText(/아직 티켓이 없습니다|No tickets yet/)).toBeInTheDocument();
  });
});

describe('MobileTicketList — pull to refresh', () => {
  it('refetches when the list is pulled down from the top', async () => {
    const onRefresh = vi.fn(async () => {});
    render(<MobileTicketList tickets={[ticket({})]} evaluations={{}} onOpen={() => {}} onNew={() => {}} onRefresh={onRefresh} />);
    const pane = screen.getByTestId('pull-scroll');
    fireEvent.touchStart(pane, { touches: [{ clientY: 0, clientX: 0 }] });
    fireEvent.touchMove(pane, { touches: [{ clientY: 140, clientX: 0 }] });
    fireEvent.touchEnd(pane, { changedTouches: [{ clientY: 140, clientX: 0 }] });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
