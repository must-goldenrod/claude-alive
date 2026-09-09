import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { MobileTicketDetail } from '../MobileTicketDetail.tsx';

afterEach(cleanup);

const base = (over: Partial<Ticket>): Ticket => ({
  id: 't1', seq: 3, goal: '로그인 버그를 고쳐줘', cwd: '/Users/me/work/app',
  state: 'done', createdAt: Date.now(), ...over,
} as Ticket);

describe('MobileTicketDetail', () => {
  it('shows the headline and the result body', () => {
    render(
      <MobileTicketDetail
        ticket={base({ headline: '세션 만료 처리 수정', result: '토큰 갱신 로직을 고쳤습니다.' })}
        onBack={() => {}} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}}
      />,
    );
    expect(screen.getByText('세션 만료 처리 수정')).toBeInTheDocument();
    expect(screen.getByText(/토큰 갱신 로직/)).toBeInTheDocument();
  });

  it('goes back', () => {
    const onBack = vi.fn();
    render(<MobileTicketDetail ticket={base({})} onBack={onBack} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /뒤로|Back/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows the question and an answer box when the agent is waiting', () => {
    render(
      <MobileTicketDetail
        ticket={base({ state: 'decision', decisionQuestion: 'A안과 B안 중 무엇으로 갈까요?' })}
        onBack={() => {}} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/A안과 B안/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('sends the answer and clears the box', async () => {
    const onReply = vi.fn(async () => true);
    render(
      <MobileTicketDetail
        ticket={base({ state: 'decision', decisionQuestion: '무엇으로 갈까요?' })}
        onBack={() => {}} onReply={onReply} onCancel={() => {}} onRetry={() => {}}
      />,
    );
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'A안으로 가주세요' } });
    fireEvent.click(screen.getByRole('button', { name: /보내기|Send/ }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('A안으로 가주세요'));
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('does not send an empty answer', () => {
    const onReply = vi.fn();
    render(
      <MobileTicketDetail
        ticket={base({ state: 'decision', decisionQuestion: '질문' })}
        onBack={() => {}} onReply={onReply} onCancel={() => {}} onRetry={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /보내기|Send/ }));
    expect(onReply).not.toHaveBeenCalled();
  });

  it('offers cancel while running and retry once it has settled', () => {
    const { rerender } = render(
      <MobileTicketDetail ticket={base({ state: 'running' })} onBack={() => {}} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /취소|Cancel/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /재시도|Retry/ })).not.toBeInTheDocument();

    rerender(<MobileTicketDetail ticket={base({ state: 'failed' })} onBack={() => {}} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: /재시도|Retry/ })).toBeInTheDocument();
  });

  it('says there is no result yet rather than showing an empty panel', () => {
    render(<MobileTicketDetail ticket={base({ state: 'running' })} onBack={() => {}} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/결과 없음|No result/)).toBeInTheDocument();
  });
});

describe('MobileTicketDetail — option taps', () => {
  it('turns the agent options into taps that fill the answer box', () => {
    render(
      <MobileTicketDetail
        ticket={base({ state: 'decision', decisionQuestion: '어느 쪽으로 갈까요? A) 지금 고친다 B) 다음 릴리즈로 미룬다' })}
        onBack={() => {}} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /지금 고친다/ }));
    expect(screen.getByRole('textbox')).toHaveValue('A. 지금 고친다');
  });

  it('leaves an unparseable question as plain text', () => {
    render(
      <MobileTicketDetail
        ticket={base({ state: 'decision', decisionQuestion: '그냥 자유 서술 질문입니다' })}
        onBack={() => {}} onReply={vi.fn()} onCancel={() => {}} onRetry={() => {}}
      />,
    );
    expect(screen.getByText('그냥 자유 서술 질문입니다')).toBeInTheDocument();
  });
});
