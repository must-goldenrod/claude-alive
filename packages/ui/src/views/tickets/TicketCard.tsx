import { useTranslation } from 'react-i18next';
import type { Ticket, TicketState } from '@claude-alive/core';

interface TicketCardProps {
  ticket: Ticket;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}

const STATE_COLOR: Record<TicketState, string> = {
  queued: 'var(--accent-blue, #58a6ff)',
  running: 'var(--accent-blue, #58a6ff)',
  verifying: 'var(--accent-blue, #58a6ff)',
  done: 'var(--accent-green, #3fb950)',
  failed: 'var(--accent-red, #f85149)',
};

function elapsed(t: Ticket): string {
  const end = t.endedAt ?? Date.now();
  const start = t.startedAt ?? t.createdAt;
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export function TicketCard({ ticket, onRetry, onCancel, onDelete }: TicketCardProps) {
  const { t } = useTranslation();
  const isActive = ticket.state === 'queued' || ticket.state === 'running' || ticket.state === 'verifying';
  const color = STATE_COLOR[ticket.state];

  return (
    <div
      style={{
        background: 'var(--bg-secondary, #161b22)',
        border: '1px solid var(--border-default, #30363d)',
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color,
            border: `1px solid ${color}`,
            borderRadius: 6,
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {t(`tickets.status.${ticket.state}`)}
          {ticket.state === 'running' && <span style={{ marginLeft: 4, opacity: 0.7 }}>●</span>}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, opacity: 0.6 }}>
          {elapsed(ticket)}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'var(--text-primary, #e6edf3)' }}>
        {ticket.goal}
      </div>

      {/* Result / error summary only on terminal states — the process itself is hidden. */}
      {ticket.state === 'done' && ticket.result && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.5 }}>{ticket.result}</div>
      )}
      {ticket.state === 'failed' && (
        <div style={{ fontSize: 12, color: 'var(--accent-red, #f85149)', lineHeight: 1.5 }}>
          {ticket.failureReason ? t(`tickets.failureReason.${ticket.failureReason}`) : t('tickets.status.failed')}
          {ticket.error ? `: ${ticket.error}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
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
        {!isActive && (
          <button type="button" onClick={() => onDelete(ticket.id)} style={{ ...btnStyle, marginLeft: 'auto' }}>
            {t('tickets.delete')}
          </button>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-default, #30363d)',
  background: 'var(--bg-tertiary, #21262d)',
  color: 'var(--text-secondary, #8b949e)',
  cursor: 'pointer',
};
