import { useTranslation } from 'react-i18next';
import type { Ticket } from '@claude-alive/core';
import { projectName, formatStarted, statusGroup, type StatusGroup } from './ticketDisplay.ts';

interface TicketCardProps {
  ticket: Ticket;
  onOpen: (ticket: Ticket) => void;
}

const GROUP_COLOR: Record<StatusGroup, string> = {
  active: 'var(--accent-blue, #58a6ff)',
  done: 'var(--accent-green, #3fb950)',
  failed: 'var(--accent-red, #f85149)',
};

export function TicketCard({ ticket, onOpen }: TicketCardProps) {
  const { t } = useTranslation();
  const group = statusGroup(ticket.state);
  const color = GROUP_COLOR[group];

  // The one-line answer is the focal point. Fall back per state while it's absent.
  const line =
    ticket.headline ??
    (group === 'active'
      ? t(`tickets.status.${ticket.state}`) + '…'
      : group === 'failed'
        ? ticket.failureReason
          ? t(`tickets.failureReason.${ticket.failureReason}`)
          : t('tickets.status.failed')
        : t('tickets.status.done'));

  const meta: string[] = [formatStarted(ticket)];
  if (ticket.model) meta.push(ticket.model);

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
      {/* top row: #seq + project badge + sub-status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, opacity: 0.55 }}>#{ticket.seq}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--accent-blue, #58a6ff)',
            background: 'color-mix(in srgb, var(--accent-blue, #58a6ff) 15%, transparent)',
            borderRadius: 6,
            padding: '2px 8px',
            maxWidth: 140,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={ticket.cwd}
        >
          {projectName(ticket.cwd)}
        </span>
        {group === 'active' && (
          <span style={{ fontSize: 11, color, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: 'pulse 1.4s infinite' }} />
            {t(`tickets.status.${ticket.state}`)}
          </span>
        )}
      </div>

      {/* the goal (what was asked), muted */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ticket.goal}
      </div>

      {/* the one-line answer — the focal point */}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color,
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {line}
      </div>

      {/* footer: date/model + detail button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', opacity: 0.5 }}>{meta.join(' · ')}</span>
        <button
          type="button"
          onClick={() => onOpen(ticket)}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-default, #30363d)',
            background: 'var(--bg-tertiary, #21262d)',
            color: 'var(--text-secondary, #8b949e)',
            cursor: 'pointer',
          }}
        >
          {t('tickets.detail')}
        </button>
      </div>
    </div>
  );
}
