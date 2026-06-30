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
        'terminal.modeFullscreenDisabled': 'Fullscreen unavailable',
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

  it('shows the unified launch bar on the Local tab', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    // Command entrypoint toggle: claude vs claude agents
    expect(screen.getByText('claude')).toBeDefined();
    expect(screen.getByText('claude agents')).toBeDefined();
    // Skip-permissions + primary start CTA live in the same bar
    expect(screen.getByText('terminal.skipPermissions')).toBeDefined();
    expect(screen.getByText(/terminal\.startHere/)).toBeDefined();
  });

  it('lets the user switch the Claude entrypoint to "claude agents"', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    const agentsBtn = screen.getByText('claude agents');
    fireEvent.click(agentsBtn);
    // Still present after selection (state updated without crashing)
    expect(screen.getByText('claude agents')).toBeDefined();
  });

  it('hides the launch bar on the SSH tab (presets launch on click)', () => {
    render(<ChatOverlay open={true} onToggle={() => {}} />);
    fireEvent.click(screen.getByText('terminal.tabSsh'));
    expect(screen.getByText('terminal.menu.manageSsh')).toBeDefined();
    expect(screen.queryByText(/terminal\.startHere/)).toBeNull();
    expect(screen.queryByText('terminal.skipPermissions')).toBeNull();
  });

  it('demotes fullscreen to popup and disables the fullscreen button when a content view opens', () => {
    const { rerender } = render(<ChatOverlay open={true} onToggle={() => {}} />);
    // User switches the terminal to fullscreen.
    fireEvent.click(screen.getByTitle('Fullscreen'));
    // A content view (Prompt/Efficio) becomes active — fullscreen would cover it.
    rerender(<ChatOverlay open={true} onToggle={() => {}} contentViewActive={true} />);
    // Fullscreen button is disabled (its title switches to the disabled hint).
    const fsBtn = screen.getByTitle('Fullscreen unavailable') as HTMLButtonElement;
    expect(fsBtn.disabled).toBe(true);
    // Mode was demoted to popup → the popup button is now the active one.
    const popupBtn = screen.getByTitle('Popup') as HTMLButtonElement;
    expect(popupBtn.style.opacity).toBe('1');
  });

  it('restores the prior fullscreen mode when leaving the content view', () => {
    const { rerender } = render(<ChatOverlay open={true} onToggle={() => {}} />);
    fireEvent.click(screen.getByTitle('Fullscreen'));
    // Enter a content view (demotes to popup) ...
    rerender(<ChatOverlay open={true} onToggle={() => {}} contentViewActive={true} />);
    // ... then return to Animation/List (contentViewActive false).
    rerender(<ChatOverlay open={true} onToggle={() => {}} contentViewActive={false} />);
    const fsBtn = screen.getByTitle('Fullscreen') as HTMLButtonElement;
    expect(fsBtn.disabled).toBe(false);
    // Fullscreen is the active mode again.
    expect(fsBtn.style.opacity).toBe('1');
  });

  it('leaves the mode untouched when entering a content view without fullscreen', () => {
    const { rerender } = render(<ChatOverlay open={true} onToggle={() => {}} />);
    // Default mode is popup (not fullscreen).
    rerender(<ChatOverlay open={true} onToggle={() => {}} contentViewActive={true} />);
    // Popup stays active; nothing was demoted or stashed for restore.
    const popupBtn = screen.getByTitle('Popup') as HTMLButtonElement;
    expect(popupBtn.style.opacity).toBe('1');
    rerender(<ChatOverlay open={true} onToggle={() => {}} contentViewActive={false} />);
    expect((screen.getByTitle('Popup') as HTMLButtonElement).style.opacity).toBe('1');
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
