import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '@claude-alive/core';
import { Markdown } from './Markdown.tsx';
import { projectName, formatStarted, statusGroup } from './ticketDisplay.ts';

interface TicketDetailModalProps {
  ticket: Ticket;
  onClose: () => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}

export function TicketDetailModal({ ticket, onClose, onRetry, onCancel, onDelete }: TicketDetailModalProps) {
  const { t } = useTranslation();
  const group = statusGroup(ticket.state);
  const isActive = group === 'active';

  // ESC closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta: string[] = [formatStarted(ticket)];
  if (ticket.model) meta.push(ticket.model);
  if (ticket.thinking) meta.push('thinking');
  if (ticket.effort) meta.push(`effort:${ticket.effort}`);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary, #161b22)',
          border: '1px solid var(--border-default, #30363d)',
          borderRadius: 14,
          width: 'min(760px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border-default, #30363d)' }}>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, opacity: 0.6 }}>#{ticket.seq}</span>
          <span style={badgeStyle}>{projectName(ticket.cwd)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontFamily: 'var(--font-mono, monospace)', opacity: 0.6 }}>
            {meta.join(' · ')}
          </span>
          <button type="button" onClick={onClose} style={{ ...btnStyle, padding: '4px 10px' }}>
            {t('tickets.close')}
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          <Section label={t('tickets.goalLabel')}>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary, #e6edf3)' }}>{ticket.goal}</div>
          </Section>

          {ticket.headline && (
            <Section label={t('tickets.headlineLabel')}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-blue, #58a6ff)' }}>{ticket.headline}</div>
            </Section>
          )}

          {ticket.state === 'failed' && (
            <Section label={t('tickets.failureLabel')}>
              <div style={{ fontSize: 13, color: 'var(--accent-red, #f85149)', lineHeight: 1.5 }}>
                {ticket.failureReason ? t(`tickets.failureReason.${ticket.failureReason}`) : ''}
                {ticket.error ? `: ${ticket.error}` : ''}
              </div>
            </Section>
          )}

          {ticket.result && (
            <Section label={t('tickets.resultLabel')}>
              <Markdown text={ticket.result} />
            </Section>
          )}

          {ticket.verification && (
            <Section label={t('tickets.verificationLabel')}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.5 }}>
                {ticket.verification.passed ? '✓ ' : '✗ '}
                {ticket.verification.reason}
              </div>
            </Section>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border-default, #30363d)' }}>
          {isActive && (
            <button type="button" onClick={() => onCancel(ticket.id)} style={btnStyle}>
              {t('tickets.cancel')}
            </button>
          )}
          {ticket.state === 'failed' && (
            <button type="button" onClick={() => onRetry(ticket.id)} style={btnStyle}>
              {t('tickets.retry')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onDelete(ticket.id);
              onClose();
            }}
            style={{ ...btnStyle, marginLeft: 'auto', color: 'var(--accent-red, #f85149)', borderColor: 'var(--accent-red, #f85149)' }}
          >
            {t('tickets.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary, #8b949e)', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--accent-blue, #58a6ff)',
  background: 'color-mix(in srgb, var(--accent-blue, #58a6ff) 15%, transparent)',
  borderRadius: 6,
  padding: '2px 8px',
};

const btnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-default, #30363d)',
  background: 'var(--bg-tertiary, #21262d)',
  color: 'var(--text-secondary, #8b949e)',
  cursor: 'pointer',
};
