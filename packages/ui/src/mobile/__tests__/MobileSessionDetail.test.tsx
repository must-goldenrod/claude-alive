import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MobileSessionDetail, type ConversationEntry } from '../MobileSessionDetail.tsx';

afterEach(cleanup);

const item = (over: Partial<ConversationEntry>): ConversationEntry => ({
  itemId: 'i1', kind: 'assistant', occurredAt: 1, text: '고쳤습니다', ...over,
});

describe('MobileSessionDetail', () => {
  it('renders the conversation in order, labelled by who said it', () => {
    render(
      <MobileSessionDetail
        title="로그인 리팩터링"
        items={[item({ itemId: 'a', kind: 'user', text: '로그인 고쳐줘' }), item({ itemId: 'b' })]}
        onBack={() => {}}
        canOpenTerminal={false}
        onOpenTerminal={() => {}}
      />,
    );
    expect(screen.getByText('로그인 고쳐줘')).toBeInTheDocument();
    expect(screen.getByText('고쳤습니다')).toBeInTheDocument();
  });

  it('shows a tool call by name rather than as blank text', () => {
    render(
      <MobileSessionDetail
        title="s" items={[item({ kind: 'tool-call', toolName: 'Bash', text: undefined })]}
        onBack={() => {}} canOpenTerminal={false} onOpenTerminal={() => {}}
      />,
    );
    expect(screen.getAllByText(/Bash/).length).toBeGreaterThan(0);
  });

  it('offers the terminal only when one is live', () => {
    const { rerender } = render(
      <MobileSessionDetail title="s" items={[]} onBack={() => {}} canOpenTerminal={false} onOpenTerminal={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: /터미널|terminal/i })).not.toBeInTheDocument();
    rerender(
      <MobileSessionDetail title="s" items={[]} onBack={() => {}} canOpenTerminal onOpenTerminal={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /터미널|terminal/i })).toBeInTheDocument();
  });

  it('goes back', () => {
    const onBack = vi.fn();
    render(<MobileSessionDetail title="s" items={[]} onBack={onBack} canOpenTerminal={false} onOpenTerminal={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /뒤로|Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
