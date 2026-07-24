import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { BackendFailure } from '../services/backendHealth.ts';

export interface BackendAlertData {
  failures: BackendFailure[];
}

interface Props {
  alert: BackendAlertData | null;
  onDismiss: () => void;
  /** Re-run the connectivity check. Resolves to the still-failing backends. */
  onRecheck: () => void;
  rechecking: boolean;
}

/**
 * Startup connectivity alert. Mirrors ResourceAlert (RAM/CPU) so a broken backend
 * connection surfaces with the same weight as a resource breach: a portal modal
 * the user must acknowledge. Lists which backends failed and offers a re-check.
 */
export function BackendAlert({ alert, onDismiss, onRecheck, rechecking }: Props) {
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

  return createPortal(
    <>
      <style>{`
        @keyframes backend-alert-pop {
          0% { opacity: 0; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes backend-alert-fade {
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
          animation: 'backend-alert-fade 200ms ease',
        }}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(460px, 92vw)',
            background: 'var(--bg-secondary)',
            border: '2px solid var(--accent-red)',
            borderRadius: 14,
            padding: '26px 28px',
            textAlign: 'center',
            boxShadow: '0 24px 64px rgba(248, 81, 73, 0.28), 0 0 0 1px rgba(248, 81, 73, 0.15)',
            animation: 'backend-alert-pop 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
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
              {/* broken-link glyph */}
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 0 1 4 8" />
              <line x1="8" y1="12" x2="12" y2="12" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px' }}>
            {t('alert.backend.title', { defaultValue: 'Backend connection needs attention' })}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.55 }}>
            {t('alert.backend.message', {
              defaultValue: 'Some backends could not be reached. Check their connection.',
            })}
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 20,
              textAlign: 'left',
            }}
          >
            {alert.failures.map((f) => (
              <div
                key={f.id}
                style={{
                  padding: '10px 12px',
                  background: 'rgba(248, 81, 73, 0.10)',
                  border: '1px solid var(--accent-red)',
                  borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-red)' }}>{f.label}</div>
                {f.detail && (
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)',
                      opacity: 0.85,
                      marginTop: 3,
                      wordBreak: 'break-word',
                    }}
                  >
                    {f.detail}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={onRecheck}
              disabled={rechecking}
              style={{
                padding: '9px 20px',
                background: 'transparent',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: rechecking ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {rechecking
                ? t('backends.checking', { defaultValue: 'Checking…' })
                : t('alert.backend.recheck', { defaultValue: 'Re-check' })}
            </button>
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
      </div>
    </>,
    document.body,
  );
}
