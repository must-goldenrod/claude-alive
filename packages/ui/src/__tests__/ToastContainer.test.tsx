import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ToastContainer, type ToastItem } from '../components/ToastContainer.tsx';

const toast: ToastItem = {
  id: 't1',
  type: 'warning',
  title: 'claude-alive · Needs permission',
  stage: 'Needs permission',
  lines: ['Folder: ~/Documents/claude-alive', 'Input: "move the toast"', 'Tool: Bash'],
  timestamp: 0,
};

describe('ToastContainer', () => {
  afterEach(() => cleanup());

  it('anchors to the bottom-left corner', () => {
    render(<ToastContainer toasts={[toast]} onDismiss={() => {}} />);
    const container = screen.getByTestId('toast-container');
    expect(container.style.bottom).toBe('16px');
    expect(container.style.left).toBe('16px');
    expect(container.style.top).toBe('');
    expect(container.style.right).toBe('');
  });

  it('shows the project, stage and every detail line', () => {
    render(<ToastContainer toasts={[toast]} onDismiss={() => {}} />);
    expect(screen.getByText('claude-alive · Needs permission')).toBeTruthy();
    for (const line of toast.lines) {
      expect(screen.getByText(line)).toBeTruthy();
    }
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
