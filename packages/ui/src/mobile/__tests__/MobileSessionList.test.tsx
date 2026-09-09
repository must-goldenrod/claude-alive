import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MobileSessionList, type MobileSession } from '../MobileSessionList.tsx';

afterEach(cleanup);

const session = (over: Partial<MobileSession>): MobileSession => ({
  sessionId: 's1', displayName: '로그인 리팩터링', state: 'ready',
  cwd: '/Users/me/work/app', lastActivityAt: 1000, needsApproval: false, ...over,
});

describe('MobileSessionList', () => {
  it('lists sessions with their project and state', () => {
    render(<MobileSessionList sessions={[session({})]} onOpen={() => {}} loading={false} />);
    expect(screen.getByText('로그인 리팩터링')).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('orders by recency — a month-old session still labelled "starting" is not news', () => {
    render(
      <MobileSessionList
        sessions={[
          session({ sessionId: 'a', displayName: '오래된 것', state: 'using-tool', lastActivityAt: 1 }),
          session({ sessionId: 'b', displayName: '방금 것', state: 'stopped', lastActivityAt: 9_000_000 }),
        ]}
        onOpen={() => {}}
        loading={false}
      />,
    );
    expect(screen.getAllByRole('button', { name: /것/ })[0]).toHaveTextContent('방금 것');
  });

  it('lifts a recently blocked session above more recent chatter', () => {
    const now = 9_000_000;
    render(
      <MobileSessionList
        sessions={[
          session({ sessionId: 'a', displayName: '방금 움직인 것', state: 'using-tool', lastActivityAt: now }),
          session({ sessionId: 'b', displayName: '승인 기다리는 것', state: 'ready', needsApproval: true, lastActivityAt: now - 600_000 }),
        ]}
        onOpen={() => {}}
        loading={false}
      />,
    );
    expect(screen.getAllByRole('button', { name: /것/ })[0]).toHaveTextContent('승인 기다리는 것');
  });

  it('does not lift a session that has been blocked since last month', () => {
    const now = 9_000_000;
    render(
      <MobileSessionList
        sessions={[
          session({ sessionId: 'a', displayName: '방금 것', state: 'using-tool', lastActivityAt: now }),
          session({ sessionId: 'b', displayName: '오래 멈춘 것', state: 'waiting-user', lastActivityAt: now - 30 * 86_400_000 }),
        ]}
        onOpen={() => {}}
        loading={false}
      />,
    );
    expect(screen.getAllByRole('button', { name: /것/ })[0]).toHaveTextContent('방금 것');
  });

  it('opens a session when tapped', () => {
    const onOpen = vi.fn();
    render(<MobileSessionList sessions={[session({})]} onOpen={onOpen} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /로그인 리팩터링/ }));
    expect(onOpen).toHaveBeenCalledWith('s1');
  });

  it('marks a session that is blocked on a human approving a tool call', () => {
    render(<MobileSessionList sessions={[session({ needsApproval: true })]} onOpen={() => {}} loading={false} />);
    expect(screen.getByLabelText(/승인|approval/i)).toBeInTheDocument();
  });

  it('explains an empty list instead of showing nothing', () => {
    render(<MobileSessionList sessions={[]} onOpen={() => {}} loading={false} />);
    expect(screen.getByText(/세션이 없습니다|No sessions/)).toBeInTheDocument();
  });
});

describe('MobileSessionList — long catalogs', () => {
  it('caps the rows after sorting, so the newest survive the cut', () => {
    // The catalog holds every session this machine has ever run. Slicing before
    // the sort handed the phone an arbitrary slab of history.
    const many = Array.from({ length: 200 }, (_, i) =>
      session({ sessionId: `s${i}`, displayName: `세션 ${i}`, lastActivityAt: i }),
    );
    render(<MobileSessionList sessions={many} onOpen={() => {}} loading={false} />);
    const rows = screen.getAllByRole('button', { name: /세션 / });
    expect(rows.length).toBeLessThanOrEqual(60);
    expect(rows[0]).toHaveTextContent('세션 199');
  });
});
