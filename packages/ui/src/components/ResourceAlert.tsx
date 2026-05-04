import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export interface ResourceAlertData {
  kind: 'cpu' | 'memory' | 'both';
  cpuPct: number;
  memPct: number;
  cpuThreshold: number;
  memThreshold: number;
}

interface Props {
  alert: ResourceAlertData | null;
  onDismiss: () => void;
}

export function ResourceAlert({ alert, onDismiss }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!alert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alert, onDismiss]);

  if (!alert) return null;

  const titleKey =
    alert.kind === 'cpu'
      ? 'alert.title.cpu'
      : alert.kind === 'memory'
        ? 'alert.title.memory'
        : 'alert.title.both';
  const titleDefault =
    alert.kind === 'cpu'
      ? 'High CPU usage'
      : alert.kind === 'memory'
        ? 'High memory usage'
        : 'High system load';

  return createPortal(
    <>
      <style>{`
        @keyframes resource-alert-pop {
          0% { opacity: 0; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes resource-alert-fade {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>
      <div
        onClick={onDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'resource-alert-fade 200ms ease',
        }}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(440px, 92vw)',
            background: 'var(--bg-secondary)',
            border: '2px solid var(--accent-red)',
            borderRadius: 14,
            padding: '26px 28px',
            textAlign: 'center',
            boxShadow:
              '0 24px 64px rgba(248, 81, 73, 0.28), 0 0 0 1px rgba(248, 81, 73, 0.15)',
            animation: 'resource-alert-pop 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 14px',
              borderRadius: '50%',
              background: 'rgba(248, 81, 73, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent-red)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h2
            style={{
              fontSize: 17,
              fontWeight: 700,
              margin: '0 0 8px',
            }}
          >
            {t(titleKey, { defaultValue: titleDefault })}
          </h2>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              margin: '0 0 18px',
              lineHeight: 1.55,
            }}
          >
            {t('alert.message', {
              defaultValue: 'System resource usage has exceeded the configured threshold.',
            })}
          </p>
          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'center',
              marginBottom: 20,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <MetricBox
              label="CPU"
              pct={alert.cpuPct}
              threshold={alert.cpuThreshold}
              highlight={alert.kind !== 'memory'}
            />
            <MetricBox
              label="RAM"
              pct={alert.memPct}
              threshold={alert.memThreshold}
              highlight={alert.kind !== 'cpu'}
            />
          </div>
          <button
            onClick={onDismiss}
            autoFocus
            style={{
              padding: '9px 22px',
              background: 'var(--accent-red)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('alert.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function MetricBox({
  label,
  pct,
  threshold,
  highlight,
}: {
  label: string;
  pct: number;
  threshold: number;
  highlight: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: '10px 14px',
        background: highlight ? 'rgba(248, 81, 73, 0.12)' : 'rgba(255, 255, 255, 0.04)',
        border: `1px solid ${highlight ? 'var(--accent-red)' : 'var(--border-color)'}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-secondary)',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: highlight ? 'var(--accent-red)' : 'var(--text-primary)',
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {Math.round(pct)}%
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.75 }}>
        ≥ {threshold}%
      </div>
    </div>
  );
}
