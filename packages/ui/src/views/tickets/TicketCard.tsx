import { useTranslation } from 'react-i18next';
import type { Ticket, TicketEvaluation } from '@claude-alive/core';
import { projectName, formatStarted, displayStatus, oneLineSummary, type DisplayStatus } from './ticketDisplay.ts';
import type { EvaluateFn } from './useTickets.ts';

interface TicketCardProps {
  ticket: Ticket;
  evaluation?: TicketEvaluation | null;
  onOpen: (ticket: Ticket) => void;
  onEvaluate?: EvaluateFn;
}

const STATUS_COLOR: Record<DisplayStatus, string> = {
  active: 'var(--accent-blue, #58a6ff)',
  complete: 'var(--accent-green, #3fb950)',
  closed: 'var(--text-secondary, #8b949e)',
  failed: 'var(--accent-red, #f85149)',
};

export function TicketCard({ ticket, evaluation, onOpen, onEvaluate }: TicketCardProps) {
  const { t } = useTranslation();
  const status = displayStatus(ticket.state, evaluation);
  const color = STATUS_COLOR[status];

  // Focal line: the one-line result. While active, show the live sub-status;
  // on failure, the reason; otherwise the headline/derived summary.
  const line =
    status === 'active'
      ? t(`tickets.status.${ticket.state}`) + '…'
      : status === 'failed'
        ? ticket.failureReason
          ? t(`tickets.failureReason.${ticket.failureReason}`)
          : t('tickets.status.failed')
        : oneLineSummary(ticket) ?? t('tickets.noResult');

  const doEval = (label: 'good' | 'bad') => {
    onEvaluate?.(ticket.id, { label });
  };

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
      {/* top row: #seq + project badge ............... time (top-right) */}
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
        <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono, monospace)', opacity: 0.5, whiteSpace: 'nowrap' }}>
          {formatStarted(ticket)}
        </span>
      </div>

      {/* the goal (what was asked), muted */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ticket.goal}
      </div>

      {/* the one-line result — the focal point */}
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

      {/* status chip row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusChip status={status} label={t(`tickets.columns.${status}`)} />
        {status === 'closed' && evaluation && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: evaluation.label === 'good' ? 'var(--accent-green, #3fb950)' : 'var(--accent-red, #f85149)',
            }}
          >
            {evaluation.label === 'good' ? t('tickets.evalGood') : t('tickets.evalBad')}
          </span>
        )}
        {ticket.model && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', opacity: 0.4 }}>{ticket.model}</span>}
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

      {/* evaluation row — only while 완료 (complete): Good/Bad closes the ticket */}
      {status === 'complete' && onEvaluate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)', opacity: 0.8 }}>{t('tickets.evaluatePrompt')}</span>
          <button type="button" onClick={() => doEval('good')} style={evalBtn('var(--accent-green, #3fb950)')}>
            {t('tickets.evalGood')}
          </button>
          <button type="button" onClick={() => doEval('bad')} style={evalBtn('var(--accent-red, #f85149)')}>
            {t('tickets.evalBad')}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status, label }: { status: DisplayStatus; label: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        borderRadius: 6,
        padding: '2px 8px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {status === 'active' && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: 'pulse 1.4s infinite' }} />
      )}
      {status === 'closed' && '✓'}
      {label}
    </span>
  );
}

function evalBtn(color: string): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '3px 12px',
    borderRadius: 8,
    border: `1px solid ${color}`,
    background: `color-mix(in srgb, ${color} 10%, transparent)`,
    color,
    cursor: 'pointer',
    fontWeight: 600,
  };
}
