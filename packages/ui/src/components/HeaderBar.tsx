import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewMode } from '../App.tsx';
import type { UsageLimitsSnapshot } from '@claude-alive/core';
import type { SystemMetrics } from '../views/dashboard/hooks/useWebSocket.ts';
import { toUsagePills, formatResetsIn } from './usagePills.ts';
import { viewsInGroup, type ViewGroup } from './viewGroups.ts';
import {
  currentPermission,
  notificationsEnabled as readNotificationsEnabled,
  setNotificationsEnabled,
  requestNotificationPermission,
} from '../services/notifications.ts';

interface HeaderBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  chatOpen?: boolean;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  onToggleChat?: () => void;
  onOpenSettings?: () => void;
  systemMetrics?: SystemMetrics | null;
  usageLimits?: UsageLimitsSnapshot | null;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)}G`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)}M`;
}

function metricColor(ratio: number): string {
  if (ratio >= 0.85) return 'var(--accent-red)';
  if (ratio >= 0.65) return 'var(--accent-amber)';
  if (ratio >= 0.3) return 'var(--accent-blue)';
  return 'var(--accent-green)';
}

interface MetricPillProps {
  label: string;
  ratio: number;
  primary: string;
  secondary?: string;
  /** Overrides the percentage text; lets an overage read >100% on a clamped bar. */
  percent?: number;
  /** Dims the pill when the value is last-known rather than fresh. */
  stale?: boolean;
}

function MetricPill({ label, ratio, primary, secondary, percent, stale }: MetricPillProps) {
  const color = metricColor(ratio);
  const pct = percent ?? Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div
      title={secondary ? `${label} ${primary} · ${secondary}` : `${label} ${primary}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        height: 28,
        borderRadius: 8,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid var(--border-color)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-secondary)',
        opacity: stale ? 0.45 : 1,
        transition: 'opacity 300ms ease',
      }}
    >
      <span style={{ fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-secondary)', opacity: 0.75 }}>
        {label}
      </span>
      <div
        style={{
          position: 'relative',
          width: 48,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: `${pct}%`,
            background: color,
            transition: 'width 500ms ease, background-color 300ms ease',
          }}
        />
      </div>
      <span style={{ color: color, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  );
}

/** A single segmented pill inside a nav group. */
function NavPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'inherit',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: active ? 'var(--bg-primary)' : 'transparent',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
        transition: 'all 0.15s ease',
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/**
 * A segmented group of nav pills. Rendered without a visible caption — the pill
 * labels already say what each surface is, so the group name only exists for
 * assistive tech via `aria-label`.
 */
function NavGroup({
  group,
  ariaLabel,
  viewMode,
  onSelect,
  t,
}: {
  group: ViewGroup;
  ariaLabel: string;
  viewMode: ViewMode;
  onSelect: (mode: ViewMode) => void;
  t: (key: string) => string;
}) {
  const views = viewsInGroup(group);
  if (views.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: 2,
      }}
    >
      {views.map(({ mode, labelKey }) => (
        <NavPill
          key={mode}
          active={viewMode === mode}
          label={t(labelKey)}
          onClick={() => onSelect(mode)}
        />
      ))}
    </div>
  );
}

export function HeaderBar({
  viewMode,
  onViewModeChange,
  leftPanelOpen = true,
  rightPanelOpen = true,
  chatOpen = false,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleChat,
  onOpenSettings,
  systemMetrics,
  usageLimits,
}: HeaderBarProps) {
  const { t, i18n } = useTranslation();
  const isKo = i18n.language?.startsWith('ko');

  // Notification permission/preference. Stored in localStorage; the bell button reflects
  // three states: unsupported (hidden), needs-permission (request on click), or
  // permission-granted (toggle enable/disable).
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() => currentPermission());
  const [notifEnabled, setNotifEnabled] = useState<boolean>(() => readNotificationsEnabled());

  // Re-sync after mount in case localStorage was changed in another tab.
  useEffect(() => {
    setNotifPerm(currentPermission());
    setNotifEnabled(readNotificationsEnabled());
  }, []);

  const handleNotifToggle = async () => {
    if (notifPerm === 'unsupported' || notifPerm === 'denied') return;
    if (notifPerm === 'default') {
      const result = await requestNotificationPermission();
      setNotifPerm(result === 'unsupported' ? 'unsupported' : result);
      setNotifEnabled(readNotificationsEnabled());
      return;
    }
    // Granted — toggle the enabled flag.
    const next = !notifEnabled;
    setNotificationsEnabled(next);
    setNotifEnabled(next);
  };

  // Minute-resolution clock for the reset countdowns; nothing else re-renders on it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const usagePills = toUsagePills(usageLimits ?? null);

  const toggleLang = () => {
    i18n.changeLanguage(isKo ? 'en' : 'ko');
  };

  const iconButtonStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    background: 'transparent',
    transition: 'all 0.2s ease',
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 24px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          claude-alive
        </span>
        <img
          src="/favicon.svg"
          alt="claude-alive logo"
          width={20}
          height={20}
          style={{ display: 'block', borderRadius: 5 }}
        />
      </div>

      {/* View navigation — three inline tiers, no dropdown and no group captions:
          primary (ticket hub) · monitor (live observation) · tools (board + workspace). */}
      <div
        role="group"
        aria-label={t('viewMode.label')}
        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
      >
        {/* Tier 1 — Tickets: the default surface, accent-emphasised. */}
        {(() => {
          const active = viewMode === 'tickets';
          return (
            <button
              role="tab"
              aria-selected={active}
              onClick={() => onViewModeChange('tickets')}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'inherit',
                borderRadius: 8,
                cursor: 'pointer',
                border: '1px solid var(--accent-blue)',
                color: active ? '#fff' : 'var(--accent-blue)',
                background: active ? 'var(--accent-blue)' : 'rgba(88, 166, 255, 0.10)',
                transition: 'all 0.15s ease',
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              {t('viewMode.tickets')}
            </button>
          );
        })()}

        <div style={{ width: 1, height: 22, background: 'var(--border-color)' }} />

        {/* Tier 2 — Monitor: live observation surfaces. */}
        <NavGroup
          group="monitor"
          ariaLabel={t('viewMode.groupMonitor')}
          viewMode={viewMode}
          onSelect={onViewModeChange}
          t={t}
        />

        <div style={{ width: 1, height: 22, background: 'var(--border-color)' }} />

        {/* Tier 3 — Tools: analysis (board) + productivity (workspace). */}
        <NavGroup
          group="tools"
          ariaLabel={t('viewMode.groupTools')}
          viewMode={viewMode}
          onSelect={onViewModeChange}
          t={t}
        />
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Claude subscription usage — 5h session, 7d, and any model-scoped weekly
            window (e.g. Fable), polled server-side every 60s. A failed poll keeps
            the last values and dims them rather than dropping the pills. */}
        {usagePills.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
            {usagePills.map((p) => {
              const resetsIn = formatResetsIn(p.resetsAt, now);
              const parts = [
                resetsIn ? t('header.usageResetsIn', { time: resetsIn }) : null,
                p.stale ? t('header.usageStale') : null,
              ].filter(Boolean) as string[];
              return (
                <MetricPill
                  key={p.label}
                  label={p.label}
                  ratio={p.ratio}
                  percent={p.percent}
                  stale={p.stale}
                  primary={`${p.percent}%`}
                  secondary={parts.length > 0 ? parts.join(' · ') : undefined}
                />
              );
            })}
          </div>
        )}

        {/* CPU / RAM indicators — live from server's os module, 2s cadence. */}
        {systemMetrics && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
            <MetricPill
              label="CPU"
              ratio={systemMetrics.cpu}
              primary={`${Math.round(systemMetrics.cpu * 100)}%`}
            />
            <MetricPill
              label="RAM"
              ratio={systemMetrics.memTotal > 0 ? systemMetrics.memUsed / systemMetrics.memTotal : 0}
              primary={`${formatBytes(systemMetrics.memUsed)} / ${formatBytes(systemMetrics.memTotal)}`}
            />
          </div>
        )}

        {/* Browser notification toggle.
            - unsupported: hidden
            - default (not asked): outlined bell, click to request
            - granted + enabled: filled bell
            - granted + disabled: outlined bell with low opacity
            - denied: muted bell with strikethrough tooltip */}
        {notifPerm !== 'unsupported' && (
          <button
            onClick={handleNotifToggle}
            disabled={notifPerm === 'denied'}
            style={{
              ...iconButtonStyle,
              cursor: notifPerm === 'denied' ? 'not-allowed' : 'pointer',
              color:
                notifPerm === 'granted' && notifEnabled
                  ? 'var(--accent-blue)'
                  : 'var(--text-secondary)',
              opacity: notifPerm === 'denied' ? 0.4 : notifPerm === 'granted' && !notifEnabled ? 0.55 : 1,
              borderColor:
                notifPerm === 'granted' && notifEnabled ? 'var(--accent-blue)' : 'var(--border-color)',
              background:
                notifPerm === 'granted' && notifEnabled ? 'rgba(88, 166, 255, 0.10)' : 'transparent',
            }}
            aria-label={t('notifications.toggle')}
            title={
              notifPerm === 'denied'
                ? t('notifications.denied')
                : notifPerm === 'default'
                  ? t('notifications.enable')
                  : notifEnabled
                    ? t('notifications.disable')
                    : t('notifications.enable')
            }
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5v1.86a3 3 0 0 1-.42 1.54L3 10.5h10l-1.08-2.1A3 3 0 0 1 11.5 6.86V5A3.5 3.5 0 0 0 8 1.5z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
                fill={notifPerm === 'granted' && notifEnabled ? 'currentColor' : 'none'}
                fillOpacity={notifPerm === 'granted' && notifEnabled ? 0.15 : 0}
              />
              <path
                d="M6.5 12.5a1.5 1.5 0 0 0 3 0"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              {notifPerm === 'denied' && (
                <line
                  x1="2.5"
                  y1="2.5"
                  x2="13.5"
                  y2="13.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        )}

        <button
          onClick={toggleLang}
          style={{
            height: 32,
            padding: '0 14px',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            color: 'var(--text-secondary)',
            background: 'transparent',
            transition: 'all 0.2s ease',
          }}
        >
          {isKo ? 'EN' : '한'}
        </button>

        {/* Left panel toggle — available in both views (ProjectSidebar exists in both). */}
        <button
          onClick={onToggleLeftPanel}
          style={iconButtonStyle}
          aria-label={t('header.toggleLeftPanel')}
          title={t('header.toggleLeftPanel')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="1" width="5" height="14" rx="1" fill={leftPanelOpen ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>

        {/* Chat & right-panel toggles only apply to Animation view:
            - In List view the terminal is always embedded, so chat toggle is meaningless.
            - In List view there is no RightPanel, so its toggle is hidden. */}
        {viewMode === 'animation' && (
          <>
            <button
              onClick={onToggleChat}
              style={iconButtonStyle}
              aria-label={t('header.toggleChat')}
              title={t('header.toggleChat')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1" y="10" width="14" height="5" rx="1" fill={chatOpen ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>

            <button
              onClick={onToggleRightPanel}
              style={iconButtonStyle}
              aria-label={t('header.toggleRightPanel')}
              title={t('header.toggleRightPanel')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
                <rect x="10" y="1" width="5" height="14" rx="1" fill={rightPanelOpen ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </>
        )}

        {/* Settings (gear) — rightmost position. Opens the SettingsModal at App level. */}
        <button
          onClick={onOpenSettings}
          style={iconButtonStyle}
          aria-label={t('header.openSettings', { defaultValue: 'Open settings' })}
          title={t('header.openSettings', { defaultValue: 'Settings' })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
