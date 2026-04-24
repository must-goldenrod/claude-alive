import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SSHErrorKind, TerminalSource } from '@claude-alive/core';

export type TabStatus = 'idle' | 'active' | 'done';

export interface Tab {
  id: string;
  label: string;
  customLabel?: string;
  exited: boolean;
  exitCode?: number;
  status: TabStatus;
  source: TerminalSource;
  sshPresetId?: string;
  sshError?: { kind: SSHErrorKind; line: string };
  /** Claude CLI session UUID (from --session-id / --resume). Matches AgentInfo.sessionId once the hook fires. */
  claudeSessionId?: string;
  /** True once user manually renamed via double-click — prevents auto-sync from sidebar from overwriting. */
  pinnedLabel?: boolean;
}

interface TerminalTabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onAdd: () => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, customLabel: string | null) => void;
}

function statusBackground(tab: Tab, isActive: boolean): string {
  if (tab.exited) {
    return isActive ? 'rgba(110, 118, 129, 0.18)' : 'transparent';
  }
  if (tab.status === 'active') {
    // Sweeping green gradient; keyframes defined in global style block
    return 'linear-gradient(90deg, rgba(46,160,67,0.05) 0%, rgba(46,160,67,0.32) 50%, rgba(46,160,67,0.05) 100%)';
  }
  return isActive ? 'rgba(88, 166, 255, 0.12)' : 'transparent';
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
  onRename,
}: TerminalTabBarProps) {
  const { t } = useTranslation();
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const commitRename = (tabId: string) => {
    const next = draftLabel.trim();
    onRename(tabId, next.length > 0 ? next : null);
    setEditingTabId(null);
    setDraftLabel('');
  };

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
        const displayLabel = tab.customLabel ?? tab.label;
        const icon = statusIcon(tab);
        const sshBorder = tab.source === 'ssh';
        const isEditing = editingTabId === tab.id;

        return (
          <div
            key={tab.id}
            onClick={() => !isEditing && onSelect(tab.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingTabId(tab.id);
              setDraftLabel(tab.customLabel ?? tab.label);
            }}
            title={
              tab.sshError
                ? t(`terminal.sshError.${tab.sshError.kind}`, { defaultValue: tab.sshError.line })
                : t('terminal.doubleClickRename')
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
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: isEditing ? 'text' : 'pointer',
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
            {isEditing ? (
              <input
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onBlur={() => commitRename(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(tab.id);
                  else if (e.key === 'Escape') {
                    setEditingTabId(null);
                    setDraftLabel('');
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: Math.max(60, draftLabel.length * 7 + 12),
                  padding: '0 2px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid var(--accent-blue)',
                  borderRadius: 3,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  outline: 'none',
                }}
              />
            ) : (
              <span style={{ opacity: tab.exited ? 0.65 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                {displayLabel}
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
            )}
            {tabs.length > 1 && !isEditing && (
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
