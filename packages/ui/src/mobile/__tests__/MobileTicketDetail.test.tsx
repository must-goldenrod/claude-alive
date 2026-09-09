import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Ticket, TicketEvaluation } from '@claude-alive/core';
import { MobileTicketDetail } from '../MobileTicketDetail.tsx';

afterEach(cleanup);

const base = (over: Partial<Ticket>): Ticket => ({
  id: 't1', seq: 3, goal: '로그인 버그를 고쳐줘', cwd: '/Users/me/work/app',
  state: 'done', createdAt: Date.now(), ...over,
} as Ticket);

const props = (ticket: Ticket, over: Record<string, unknown> = {}) => ({
  ticket,
  evaluation: null as TicketEvaluation | null,
  onBack: vi.fn(),
  onReply: vi.fn(async () => true),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  onDelete: vi.fn(),
  onEvaluate: vi.fn(),
  ...over,
});

describe('MobileTicketDetail — desktop parity', () => {
  it('shows the headline and the result body', () => {
    render(<MobileTicketDetail {...props(base({ headline: '세션 만료 처리 수정', result: '토큰 갱신 로직을 고쳤습니다.' }))} />);
    expect(screen.getByText('세션 만료 처리 수정')).toBeInTheDocument();
    expect(screen.getByText(/토큰 갱신 로직/)).toBeInTheDocument();
  });

  it('names the state in a badge rather than only colouring a dot', () => {
    render(<MobileTicketDetail {...props(base({ state: 'running' }))} />);
    expect(screen.getByText(/실행중|Running/)).toBeInTheDocument();
  });

  it('says whether the work was verified', () => {
    render(<MobileTicketDetail {...props(base({ verification: { passed: true } as never }))} />);
    expect(screen.getAllByText(/검증완료|Verified/).length).toBeGreaterThan(0);
  });

  it('marks a flagged verdict differently from a passing one', () => {
    render(<MobileTicketDetail {...props(base({ verification: { passed: false } as never }))} />);
    expect(screen.getAllByText(/이견있음|Flagged/).length).toBeGreaterThan(0);
  });

  it('shows the run information the desktop modal shows', () => {
    render(<MobileTicketDetail {...props(base({ model: 'claude-opus-5', effort: 'high', preset: 'deep' } as never))} />);
    expect(screen.getByText('claude-opus-5')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('says where it ran — local, or which host over ssh', () => {
    const { rerender } = render(<MobileTicketDetail {...props(base({}))} />);
    expect(screen.getByText(/로컬|Local/)).toBeInTheDocument();
    rerender(
      <MobileTicketDetail
        {...props(base({ location: { kind: 'ssh', ssh: { host: '192.168.100.99', user: 'dev' } } as never }))}
      />,
    );
    expect(screen.getByText(/dev@192\.168\.100\.99/)).toBeInTheDocument();
  });

  it('goes back from an icon, not a labelled button', () => {
    const onBack = vi.fn();
    render(<MobileTicketDetail {...props(base({}), { onBack })} />);
    const back = screen.getByRole('button', { name: /뒤로|Back/ });
    expect(back).toHaveTextContent('‹');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalled();
  });

  it('offers retry and delete once settled, cancel while it runs', () => {
    const { rerender } = render(<MobileTicketDetail {...props(base({ state: 'running' }))} />);
    expect(screen.getByRole('button', { name: /취소|Cancel/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /재시도|Retry/ })).not.toBeInTheDocument();
    rerender(<MobileTicketDetail {...props(base({ state: 'failed' }))} />);
    expect(screen.getByRole('button', { name: /재시도|Retry/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /삭제|Delete/ })).toBeInTheDocument();
  });

  it('asks before deleting, because the button sits next to retry', () => {
    const onDelete = vi.fn();
    render(<MobileTicketDetail {...props(base({}), { onDelete })} />);
    fireEvent.click(screen.getByRole('button', { name: /삭제|Delete/ }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /삭제할까요|Delete this/ }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('records a five-point rating on a settled ticket', () => {
    const onEvaluate = vi.fn();
    render(<MobileTicketDetail {...props(base({ state: 'done' }), { onEvaluate })} />);
    fireEvent.click(screen.getByRole('button', { name: /매우좋음|Very good/i }));
    expect(onEvaluate).toHaveBeenCalledWith('good', 5);
  });

  it('does not offer a rating while the ticket is still running', () => {
    render(<MobileTicketDetail {...props(base({ state: 'running' }))} />);
    expect(screen.queryByRole('button', { name: /매우좋음|Very good/i })).not.toBeInTheDocument();
  });
});

describe('MobileTicketDetail — the parked question', () => {
  it('shows the question and an answer box when the agent is waiting', () => {
    render(<MobileTicketDetail {...props(base({ state: 'decision', decisionQuestion: 'A안과 B안 중 무엇으로 갈까요?' }))} />);
    expect(screen.getByText(/A안과 B안/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('sends the answer and clears the box', async () => {
    const onReply = vi.fn(async () => true);
    render(<MobileTicketDetail {...props(base({ state: 'decision', decisionQuestion: '무엇으로 갈까요?' }), { onReply })} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'A안으로 가주세요' } });
    fireEvent.click(screen.getByRole('button', { name: /보내기|Send/ }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('A안으로 가주세요'));
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('turns the agent options into taps that fill the answer box', () => {
    render(
      <MobileTicketDetail
        {...props(base({ state: 'decision', decisionQuestion: '어느 쪽으로 갈까요? A) 지금 고친다 B) 다음 릴리즈로 미룬다' }))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /지금 고친다/ }));
    expect(screen.getByRole('textbox')).toHaveValue('A. 지금 고친다');
  });

  it('says there is no result yet rather than showing an empty panel', () => {
    render(<MobileTicketDetail {...props(base({ state: 'running' }))} />);
    expect(screen.getByText(/결과 없음|No result/)).toBeInTheDocument();
  });
});
