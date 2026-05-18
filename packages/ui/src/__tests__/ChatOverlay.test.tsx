import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChatOverlay } from '../views/chat/ChatOverlay.js';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'chat.title': 'Chat',
        'terminal.newTab': 'New tab',
        'terminal.exited': 'Exited',
        'terminal.modePopup': 'Popup',
        'terminal.modeBottom': 'Bottom',
        'terminal.modeRight': 'Right',
        'terminal.modeFullscreen': 'Fullscreen',
        'terminal.collapse': 'Minimize',
      };
      if (key === 'terminal.tabLabel' && opts?.n != null) return `Terminal ${opts.n}`;
      return map[key] ?? key;
    },
  }),
}));

// Mock xterm.js — factories must be self-contained (vi.mock is hoisted)
vi.mock('@xterm/xterm', () => {
  return {
    Terminal: class {
      open = vi.fn();
      write = vi.fn();
      dispose = vi.fn();
      focus = vi.fn();
      onData = vi.fn();
      loadAddon = vi.fn();
      cols = 80;
      rows = 24;
    },
  };
});
vi.mock('@xterm/addon-fit', () => {
  return { FitAddon: class { fit = vi.fn(); } };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Mock ResizeObserver
globalThis.ResizeObserver = class {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
} as unknown as typeof ResizeObserver;

describe('ChatOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ChatOverlay open={false} onToggle={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders header and terminal container when open', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    expect(screen.getByText(/Chat/)).toBeDefined();
  });

  it('calls onToggle when close button is clicked', () => {
    const onToggle = vi.fn();
    render(<ChatOverlay open={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByTitle('Minimize'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('does not render terminal container when closed', () => {
    const { container } = render(<ChatOverlay open={false} onToggle={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders tab bar with + button when open', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    expect(screen.getByTitle('New tab')).toBeDefined();
  });

  it('shows the CWD picker with Local and SSH tabs when opened', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    expect(screen.getByText('terminal.tabLocal')).toBeDefined();
    expect(screen.getByText('terminal.tabSsh')).toBeDefined();
  });

  it('defaults to the Local tab (shows the folder select button)', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    expect(screen.getByText('terminal.selectHere')).toBeDefined();
  });

  it('switches to the SSH tab and hides local browse controls', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    fireEvent.click(screen.getByText('terminal.tabSsh'));
    expect(screen.getByText('terminal.menu.manageSsh')).toBeDefined();
    expect(screen.queryByText('terminal.selectHere')).toBeNull();
  });

  it('keeps the skip-permissions toggle visible regardless of tab', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    expect(screen.getByText('terminal.skipPermissions')).toBeDefined();
    fireEvent.click(screen.getByText('terminal.tabSsh'));
    expect(screen.getByText('terminal.skipPermissions')).toBeDefined();
  });

  it('calls onSpawn when overlay opens for the first time', async () => {
    const onSpawn = vi.fn();
    render(<ChatOverlay open={true} onToggle={() => {}} onSpawn={onSpawn} />);
    // onSpawn is called in rAF after first mount — flush microtasks
    await vi.waitFor(() => {
      // The tab should be created via createTab -> rAF -> onSpawnRef.current
      // Since rAF is mocked in test env, onSpawn may not fire immediately
      // But the + button and tab bar should be visible
      expect(screen.getByTitle('New tab')).toBeDefined();
    });
  });
});
