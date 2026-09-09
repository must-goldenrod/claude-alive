import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MobileTerminal } from '../MobileTerminal.tsx';

afterEach(cleanup);

const props = (over = {}) => ({
  title: 'app',
  output: '',
  canType: true,
  exited: false,
  onBack: vi.fn(),
  onSend: vi.fn(),
  onKey: vi.fn(),
  ...over,
});

describe('MobileTerminal', () => {
  it('shows the output it has received', () => {
    render(<MobileTerminal {...props({ output: '$ ls\nREADME.md\n' })} />);
    expect(screen.getByText(/README\.md/)).toBeInTheDocument();
  });

  it('sends a typed line and clears the box', () => {
    const onSend = vi.fn();
    render(<MobileTerminal {...props({ onSend })} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'git status' } });
    fireEvent.click(screen.getByRole('button', { name: /전송|Send/i }));
    // A shell acts on the carriage return, not on the characters.
    expect(onSend).toHaveBeenCalledWith('git status\r');
    expect(box).toHaveValue('');
  });

  it('does not send an empty line by accident', () => {
    const onSend = vi.fn();
    render(<MobileTerminal {...props({ onSend })} />);
    fireEvent.click(screen.getByRole('button', { name: /전송|Send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('offers the keys a phone keyboard cannot produce', () => {
    const onKey = vi.fn();
    render(<MobileTerminal {...props({ onKey })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl-C' }));
    expect(onKey).toHaveBeenCalledWith('\x03');
    fireEvent.click(screen.getByRole('button', { name: 'Esc' }));
    expect(onKey).toHaveBeenCalledWith('\x1b');
    fireEvent.click(screen.getByRole('button', { name: '↑' }));
    expect(onKey).toHaveBeenCalledWith('\x1b[A');
  });

  it('hides every input control when typing is not permitted', () => {
    render(<MobileTerminal {...props({ canType: false })} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ctrl-C' })).not.toBeInTheDocument();
    expect(screen.getByText(/읽기 전용|Read-only/i)).toBeInTheDocument();
  });

  it('says when the terminal has exited instead of looking merely idle', () => {
    render(<MobileTerminal {...props({ exited: true })} />);
    expect(screen.getByText(/종료되었습니다|has exited/i)).toBeInTheDocument();
  });
});
