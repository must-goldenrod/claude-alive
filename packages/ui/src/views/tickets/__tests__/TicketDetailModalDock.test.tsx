import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketEvaluation } from '@claude-alive/core';
import { TicketDetailModal } from '../TicketDetailModal.tsx';

afterEach(cleanup);

/** The scrolling body is the only flex-grown region inside the modal shell. */
function scrollBody(container: HTMLElement): HTMLElement {
  const body = container.querySelector<HTMLElement>('div[style*="min-height: 0"]');
  if (!body) throw new Error('scrollable modal body not found');
  return body;
}

const base: Ticket = {
  id: 't1',
  seq: 1,
  goal: 'build the thing',
  cwd: '/tmp/repo',
  state: 'decision',
  createdAt: 0,
  result: 'context that belongs in the scrolling body',
  decisionQuestion: '어느 쪽으로 갈까요? A) 지금 수정 B) 다음 PR로',
};

const evaluation: TicketEvaluation = {
  ticketId: 't1',
  seq: 1,
  route: '/tmp/repo',
  goal: 'build the thing',
  autoLabel: 'unrated',
  label: 'unrated',
  humanLabeled: false,
  weight: 3,
  reflected: false,
  createdAt: 0,
  updatedAt: 0,
};

const noop = () => {};

describe('TicketDetailModal bottom dock', () => {
  it('pins the pending decision outside the scrolling body', () => {
    const { container } = render(
      <TicketDetailModal
        ticket={base}
        onClose={noop}
        onRetry={noop}
        onCancel={noop}
        onDelete={noop}
        onReply={async () => true}
      />,
    );

    const option = screen.getByRole('button', { name: /지금 수정/ });
    expect(scrollBody(container).contains(option)).toBe(false);
    // The context it is about still scrolls in the body.
    expect(scrollBody(container)).toHaveTextContent('context that belongs in the scrolling body');
  });

  it('lays the decision options out in a wrapping row, not a full-width stack', () => {
    render(
      <TicketDetailModal
        ticket={base}
        onClose={noop}
        onRetry={noop}
        onCancel={noop}
        onDelete={noop}
        onReply={async () => true}
      />,
    );

    const option = screen.getByRole('button', { name: /지금 수정/ });
    expect(option.style.width).not.toBe('100%');
    expect(option.style.flex).toBe('1 1 220px');
    expect(option.parentElement?.style.flexWrap).toBe('wrap');
    expect(option.parentElement?.style.flexDirection).not.toBe('column');
  });

  it('pins the 5-point rating outside the scrolling body when the ticket is settled', () => {
    const { container } = render(
      <TicketDetailModal
        ticket={{ ...base, state: 'done', decisionQuestion: undefined }}
        evaluation={evaluation}
        onClose={noop}
        onRetry={noop}
        onCancel={noop}
        onDelete={noop}
        onEvaluate={vi.fn().mockResolvedValue(true)}
      />,
    );

    const body = scrollBody(container);
    for (const name of [/매우나쁨|Very bad/, /나쁨|Bad/, /보통|Neutral/, /좋음|Good/, /매우좋음|Very good/]) {
      const btn = screen.getAllByRole('button', { name })[0];
      expect(body.contains(btn)).toBe(false);
    }
  });

  it('renders no dock when there is neither a decision nor an evaluation', () => {
    const { container } = render(
      <TicketDetailModal
        ticket={{ ...base, state: 'done', decisionQuestion: undefined }}
        onClose={noop}
        onRetry={noop}
        onCancel={noop}
        onDelete={noop}
      />,
    );

    expect(container.querySelector('div[style*="max-height: 40vh"]')).toBeNull();
  });
});
