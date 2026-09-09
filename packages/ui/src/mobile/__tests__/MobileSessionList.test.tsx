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

  it('puts the sessions that are doing something first', () => {
    render(
      <MobileSessionList
        sessions={[
          session({ sessionId: 'a', displayName: '멈춘 것', state: 'stopped', lastActivityAt: 9000 }),
          session({ sessionId: 'b', displayName: '도구 쓰는 중', state: 'using-tool', lastActivityAt: 1 }),
        ]}
        onOpen={() => {}}
        loading={false}
      />,
    );
    const rows = screen.getAllByRole('button', { name: /것|중/ });
    expect(rows[0]).toHaveTextContent('도구 쓰는 중');
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
