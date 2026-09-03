import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { TicketDetailModal } from '../TicketDetailModal.tsx';

afterEach(cleanup);

const decisionTicket: Ticket = {
  id: 't1',
  seq: 1,
  goal: 'build the thing',
  cwd: '/tmp/repo',
  state: 'decision',
  createdAt: 0,
  decisionQuestion: '어느 쪽으로 갈까요? A) 지금 수정 B) 다음 PR로',
};

function renderModal(onReply: (id: string, text: string) => Promise<boolean>) {
  const onClose = vi.fn();
  const { container } = render(
    <TicketDetailModal
      ticket={decisionTicket}
      onClose={onClose}
      onRetry={() => {}}
      onCancel={() => {}}
      onDelete={() => {}}
      onReply={onReply}
    />,
  );
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('reply composer textarea not rendered');
  return { onClose, textarea };
}

describe('TicketDetailModal decision reply', () => {
  it('closes the modal after the send button submits successfully', async () => {
    const onReply = vi.fn().mockResolvedValue(true);
    const { onClose, textarea } = renderModal(onReply);

    fireEvent.change(textarea, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: /send|보내기/i }));

    await waitFor(() => expect(onReply).toHaveBeenCalledWith('t1', 'A'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes the modal after Ctrl+Enter submits successfully', async () => {
    const onReply = vi.fn().mockResolvedValue(true);
    const { onClose, textarea } = renderModal(onReply);

    fireEvent.change(textarea, { target: { value: 'B로 가죠' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(onReply).toHaveBeenCalledWith('t1', 'B로 가죠'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the modal open and preserves the draft when the send fails', async () => {
    const onReply = vi.fn().mockResolvedValue(false);
    const { onClose, textarea } = renderModal(onReply);

    fireEvent.change(textarea, { target: { value: 'A' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(onReply).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('A');
  });

  it('does not submit an empty draft', () => {
    const onReply = vi.fn().mockResolvedValue(true);
    const { onClose, textarea } = renderModal(onReply);

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onReply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
