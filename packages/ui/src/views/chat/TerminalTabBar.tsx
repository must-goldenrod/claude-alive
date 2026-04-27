import { useTranslation } from 'react-i18next';
import type { SSHErrorKind, TerminalSource } from '@claude-alive/core';

export type TabStatus = 'idle' | 'active' | 'done';

export interface Tab {
  id: string;
  /** Display label. Computed from projectName (if any) or pathBasename(cwd). */
  label: string;
  /** cwd this tab targets; used to look up the project name and keep labels reactive. */
  cwd?: string;
  exited: boolean;
  exitCode?: number;
  status: TabStatus;
  source: TerminalSource;
  sshPresetId?: string;
  sshError?: { kind: SSHErrorKind; line: string };
  /** Claude CLI session UUID (from --session-id / --resume). */
  claudeSessionId?: string;
}

interface TerminalTabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onAdd: () => void;
  onClose: (tabId: string) => void;
}

function statusBackground(tab: Tab, isActive: boolean): string {
  if (tab.exited) {
    return isActive ? 'rgba(110, 118, 129, 0.18)' : 'transparent';
  }
  if (tab.status === 'active') {
    return 'linear-gradient(90deg, rgba(46,160,67,0.05) 0%, rgba(46,160,67,0.32) 50%, rgba(46,160,67,0.05) 100%)';
  }
  return isActive ? 'rgba(88, 166, 255, 0.14)' : 'transparent';
}

function statusIcon(tab: Tab): string | null {
  if (!tab.exited) return null;
  if (tab.exitCode === 0) return '✓';
  return '✗';
}

function statusIconColor(tab: Tab): string {
  if (!tab.exited) return 'var(--text-secondary)';
  return tab.exitCode === 0 ? 'var(--accent-green, #3fb950)' : 'var(--accent-red, #f85149)';
}

function borderForSource(tab: Tab): string {
  if (tab.source === 'ssh') {
    const color = tab.sshError ? 'var(--accent-red, #f85149)' : 'var(--accent-purple, #bc8cff)';
    return `2px solid ${color}`;
  }
  return '2px solid transparent';
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onAdd,
  onClose,
}: TerminalTabBarProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '4px 8px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const icon = statusIcon(tab);
        const sshBorder = tab.source === 'ssh';

        return (
          <div
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            title={
              tab.sshError
                ? t(`terminal.sshError.${tab.sshError.kind}`, { defaultValue: tab.sshError.line })
                : tab.label
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: statusBackground(tab, isActive),
              backgroundSize: tab.status === 'active' ? '200% 100%' : undefined,
              animation:
                tab.status === 'active'
                  ? 'claude-tab-sweep 1.8s linear infinite'
                  : undefined,
              borderLeft: sshBorder ? borderForSource(tab) : 'none',
              border: sshBorder ? undefined : 'none',
              borderRadius: 6,
              boxShadow: isActive ? 'inset 0 0 0 1px rgba(88, 166, 255, 0.35)' : undefined,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              whiteSpace: 'nowrap',
              transition: 'background-color 0.15s ease',
            }}
          >
            {sshBorder && (
              <span
                aria-hidden
                style={{
                  fontSize: 9,
                  opacity: 0.7,
                  color: tab.sshError
                    ? 'var(--accent-red, #f85149)'
                    : 'var(--accent-purple, #bc8cff)',
                }}
              >
                {tab.sshError ? '⚠' : '⇄'}
              </span>
            )}
            <span style={{ opacity: tab.exited ? 0.65 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
              {tab.label}
              {icon && (
                <span style={{ color: statusIconColor(tab), fontSize: 10, lineHeight: 1 }}>
                  {icon}
                </span>
              )}
              {tab.exited && (
                <span style={{ opacity: 0.55 }}>
                  ({t('terminal.exited')}
                  {typeof tab.exitCode === 'number' ? ` · ${tab.exitCode}` : ''})
                </span>
              )}
            </span>
            {tabs.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                style={{
                  fontSize: 10,
                  lineHeight: 1,
                  padding: '1px 3px',
                  borderRadius: 3,
                  opacity: 0.5,
                  cursor: 'pointer',
                }}
              >
                ✕
              </span>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        title={t('terminal.newTab')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1,
          flexShrink: 0,
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(88, 166, 255, 0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        +
      </button>
    </div>
  );
}
