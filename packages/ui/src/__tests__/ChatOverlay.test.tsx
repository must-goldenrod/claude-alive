import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ChatOverlay } from '../views/chat/ChatOverlay.js';
import type { ChatEventHandler } from '../views/chat/ChatOverlay.js';
import { createRef } from 'react';
import type { MutableRefObject } from 'react';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      const map: Record<string, string> = {
        'chat.title': 'Chat',
        'chat.placeholder': 'Send a message...',
        'chat.streaming': 'Thinking...',
      };
      if (key === 'chat.error' && opts?.message) return `Error: ${opts.message}`;
      return map[key] ?? key;
    },
  }),
}));

describe('ChatOverlay', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ChatOverlay open={false} onToggle={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders header and input when open', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    expect(screen.getByText(/Chat/)).toBeDefined();
    expect(screen.getByPlaceholderText('Send a message...')).toBeDefined();
  });

  it('calls onToggle when close button is clicked', () => {
    const onToggle = vi.fn();
    render(<ChatOverlay open={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('✕'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('sends a message on Enter and calls onSend', () => {
    const onSend = vi.fn();
    render(<ChatOverlay open={true} onToggle={() => {}} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Send a message...');

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(screen.getByText('hello')).toBeDefined();
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('does not send on Shift+Enter (allows newline)', () => {
    const onSend = vi.fn();
    const { container } = render(<ChatOverlay open={true} onToggle={() => {}} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Send a message...');

    fireEvent.change(textarea, { target: { value: 'line1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    const bubbles = container.querySelectorAll('[style*="border-radius: 14px"]');
    expect(bubbles.length).toBe(0);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send empty/whitespace messages', () => {
    const onSend = vi.fn();
    const { container } = render(<ChatOverlay open={true} onToggle={() => {}} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Send a message...');

    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    const messageArea = container.querySelectorAll('[style*="border-radius: 14px"]');
    expect(messageArea.length).toBe(0);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends message via send button click', () => {
    const onSend = vi.fn();
    render(<ChatOverlay open={true} onToggle={() => {}} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Send a message...');

    fireEvent.change(textarea, { target: { value: 'click send' } });
    fireEvent.click(screen.getByText('▶▶'));

    expect(screen.getByText('click send')).toBeDefined();
    expect(onSend).toHaveBeenCalledWith('click send');
  });

  it('clears input after sending', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    const textarea = screen.getByPlaceholderText('Send a message...') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(textarea.value).toBe('');
  });

  it('displays streaming chunks from chatEventRef', () => {
    const chatEventRef = createRef<ChatEventHandler | null>() as MutableRefObject<ChatEventHandler | null>;
    chatEventRef.current = null;

    render(
      <ChatOverlay open={true} onToggle={() => {}} chatEventRef={chatEventRef} />
    );

    // Simulate streaming chunks
    act(() => {
      chatEventRef.current?.({ type: 'chat:chunk', text: 'Hello', sessionId: 's1' });
    });
    expect(screen.getByText(/Hello/)).toBeDefined();

    act(() => {
      chatEventRef.current?.({ type: 'chat:chunk', text: ' world', sessionId: 's1' });
    });
    expect(screen.getByText(/Hello world/)).toBeDefined();

    // End streaming
    act(() => {
      chatEventRef.current?.({ type: 'chat:end', sessionId: 's1' });
    });
    // Message should still be visible
    expect(screen.getByText(/Hello world/)).toBeDefined();
  });

  it('displays error from chatEventRef', () => {
    const chatEventRef = createRef<ChatEventHandler | null>() as MutableRefObject<ChatEventHandler | null>;
    chatEventRef.current = null;

    render(
      <ChatOverlay open={true} onToggle={() => {}} chatEventRef={chatEventRef} />
    );

    act(() => {
      chatEventRef.current?.({ type: 'chat:error', error: 'connection failed', sessionId: null });
    });

    expect(screen.getByText('Error: connection failed')).toBeDefined();
  });
});
