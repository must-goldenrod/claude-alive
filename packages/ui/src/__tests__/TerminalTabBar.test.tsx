import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TerminalTabBar, type Tab } from '../views/chat/TerminalTabBar.js';

// Mock i18next so status labels resolve to predictable strings.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'terminal.newTab': 'New tab',
        'terminal.exited': 'Exited',
        'terminal.status.waiting': 'Waiting',
      };
      if (key === 'terminal.tabLabel' && opts?.n != null) return `Terminal ${opts.n}`;
      return map[key] ?? key;
    },
  }),
}));

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 't1',
    label: 'my-project',
    exited: false,
    status: 'idle',
    source: 'local',
    ...overrides,
  };
}

describe('TerminalTabBar status label', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a persistent "(Waiting)" status text when a tab is waiting on the user', () => {
    const tab = makeTab({ status: 'waiting' });
    render(
      <TerminalTabBar
        tabs={[tab]}
        activeTabId="t1"
        onSelect={() => {}}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    // The terminal name stays visible…
    expect(screen.getByText('my-project')).toBeTruthy();
    // …and the waiting status is surfaced textually so the user knows Claude
    // is asking for their decision (not just a subtle colour change).
    expect(screen.getByText(/Waiting/)).toBeTruthy();
  });

  it('does not show a waiting status text for an idle tab', () => {
    const tab = makeTab({ status: 'idle' });
    render(
      <TerminalTabBar
        tabs={[tab]}
        activeTabId="t1"
        onSelect={() => {}}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/Waiting/)).toBeNull();
  });
});

describe('TerminalTabBar resume button', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderBar = (tab: Tab, onResume = vi.fn(), onSelect = vi.fn()) => {
    render(
      <TerminalTabBar
        tabs={[tab]}
        activeTabId="t1"
        onSelect={onSelect}
        onAdd={() => {}}
        onClose={() => {}}
        onResume={onResume}
      />,
    );
    return { onResume, onSelect };
  };

  it('resumes an exited Claude tab without selecting it', () => {
    const { onResume, onSelect } = renderBar(makeTab({ exited: true, exitCode: 143, claudeSessionId: 'sid' }));
    screen.getByRole('button', { name: 'terminal.resumeTab' }).click();
    expect(onResume).toHaveBeenCalledWith('t1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hides the button for live, ssh, shell, and session-less tabs', () => {
    for (const tab of [
      makeTab({ claudeSessionId: 'sid' }),
      makeTab({ exited: true, source: 'ssh', claudeSessionId: 'sid' }),
      makeTab({ exited: true, mode: 'shell', claudeSessionId: 'sid' }),
      makeTab({ exited: true }),
    ]) {
      renderBar(tab);
      expect(screen.queryByRole('button', { name: 'terminal.resumeTab' })).toBeNull();
      cleanup();
    }
  });
});
