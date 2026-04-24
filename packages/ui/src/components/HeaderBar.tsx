import { useTranslation } from 'react-i18next';
import type { ViewMode } from '../App.tsx';
import type { SystemMetrics } from '../views/dashboard/hooks/useWebSocket.ts';

interface HeaderBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  chatOpen?: boolean;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  onToggleChat?: () => void;
  systemMetrics?: SystemMetrics | null;
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
}

function MetricPill({ label, ratio, primary, secondary }: MetricPillProps) {
  const color = metricColor(ratio);
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
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

const VIEW_MODES: { mode: ViewMode; labelKey: string }[] = [
  { mode: 'animation', labelKey: 'viewMode.animation' },
  { mode: 'list', labelKey: 'viewMode.list' },
];

export function HeaderBar({
  viewMode,
  onViewModeChange,
  leftPanelOpen = true,
  rightPanelOpen = true,
  chatOpen = false,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleChat,
  systemMetrics,
}: HeaderBarProps) {
  const { t, i18n } = useTranslation();
  const isKo = i18n.language?.startsWith('ko');

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

      {/* View mode segmented control */}
      <div
        role="tablist"
        aria-label={t('viewMode.label')}
        style={{
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          padding: 2,
        }}
      >
        {VIEW_MODES.map(({ mode, labelKey }) => {
          const active = viewMode === mode;
          return (
            <button
              key={mode}
              role="tab"
              aria-selected={active}
              onClick={() => onViewModeChange(mode)}
              style={{
                padding: '6px 14px',
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
              }}
            >
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
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
      </div>
    </div>
  );
}
